-- Dev Console: issuer signature on lifetime keys, strict email binding at activation

ALTER TABLE access_keys
  ADD COLUMN IF NOT EXISTS issuer_signature_hash TEXT;

COMMENT ON COLUMN access_keys.issuer_signature_hash IS
  'HMAC hash of developer issuer signature at key creation; NULL = not issued via signed dev console flow';

ALTER TABLE access_keys
  DROP CONSTRAINT IF EXISTS access_keys_lifetime_email_required;

ALTER TABLE access_keys
  ADD CONSTRAINT access_keys_lifetime_pending_email_required
  CHECK (
    NOT (key_type = 'lifetime' AND status = 'pending')
    OR email IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_access_keys_lifetime_pending_email
  ON access_keys (lower(email))
  WHERE key_type = 'lifetime' AND status = 'pending';

-- =============================================================================
-- activate_access_key — lifetime keys require recipient email match (like demo)
-- =============================================================================

CREATE OR REPLACE FUNCTION activate_access_key(
  p_key_hash text,
  p_org_name text DEFAULT NULL,
  p_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := COALESCE(p_user_id, auth.uid());
  v_user_email text;
  v_key access_keys%ROWTYPE;
  v_current_version_id uuid;
  v_org_id uuid;
  v_member_id uuid;
  v_org_name text;
  v_slug text;
  v_slug_base text;
  v_slug_suffix int := 0;
  v_existing_org organizations%ROWTYPE;
  v_now timestamptz := now();
  v_demo_expires timestamptz;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_user_id IS NOT NULL AND auth.uid() IS NOT NULL AND p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  IF p_key_hash IS NULL OR length(trim(p_key_hash)) = 0 THEN
    RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;
  IF v_user_email IS NULL OR trim(v_user_email) = '' THEN
    RAISE EXCEPTION 'email required for key activation' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_key
  FROM access_keys
  WHERE key_hash = p_key_hash
    AND status = 'pending'
    AND revoked_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
  END IF;

  v_current_version_id := current_crm_version_id();
  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'crm version not configured' USING ERRCODE = '22023';
  END IF;

  IF v_key.crm_version_id IS DISTINCT FROM v_current_version_id THEN
    RAISE EXCEPTION 'key for different CRM version' USING ERRCODE = '22023';
  END IF;

  v_demo_expires := v_now + interval '30 days';

  IF v_key.key_type = 'demo' THEN
    IF v_key.email IS NULL OR lower(trim(v_key.email)) <> lower(trim(v_user_email)) THEN
      RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
    END IF;

    v_org_name := coalesce(nullif(trim(p_org_name), ''), 'Demo Organization');
    v_slug_base := slugify_org_name(v_org_name);
    v_slug := v_slug_base;

    WHILE EXISTS (SELECT 1 FROM organizations o WHERE o.slug = v_slug) LOOP
      v_slug_suffix := v_slug_suffix + 1;
      v_slug := v_slug_base || '-' || v_slug_suffix::text;
    END LOOP;

    INSERT INTO organizations (
      name, slug, status, crm_version_id, access_key_id,
      demo_activated_at, demo_expires_at, data_purge_at, owner_user_id
    )
    VALUES (
      v_org_name, v_slug, 'demo_active', v_key.crm_version_id, v_key.id,
      v_now, v_demo_expires, v_demo_expires, v_user_id
    )
    RETURNING id INTO v_org_id;

    INSERT INTO organization_settings (organization_id) VALUES (v_org_id);

    INSERT INTO organization_members (organization_id, user_id, role, display_name, joined_at)
    VALUES (v_org_id, v_user_id, 'owner', split_part(v_user_email, '@', 1), v_now)
    RETURNING id INTO v_member_id;

    PERFORM sync_member_profile_from_auth(v_member_id);

    UPDATE access_keys
    SET status = 'active', organization_id = v_org_id, activated_at = v_now,
        demo_expires_at = v_demo_expires, data_purge_at = v_demo_expires
    WHERE id = v_key.id;

    INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
    VALUES (v_user_id, v_org_id, v_member_id, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          member_id = EXCLUDED.member_id,
          updated_at = EXCLUDED.updated_at;

    RETURN jsonb_build_object(
      'organization_id', v_org_id, 'key_type', 'demo', 'status', 'demo_active', 'upgraded', false
    );
  END IF;

  IF v_key.key_type = 'lifetime' THEN
    IF v_key.email IS NULL OR lower(trim(v_key.email)) <> lower(trim(v_user_email)) THEN
      RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
    END IF;

    SELECT o.* INTO v_existing_org
    FROM organizations o
    WHERE o.owner_user_id = v_user_id
      AND o.status IN ('demo_active', 'demo_retention')
    ORDER BY o.created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
      v_org_id := v_existing_org.id;

      UPDATE organizations
      SET status = 'licensed', access_key_id = v_key.id, data_purge_at = NULL, demo_expires_at = NULL
      WHERE id = v_org_id;

      INSERT INTO organization_licenses (
        organization_id, crm_version_id, license_type, access_key_id, activated_at, expires_at
      )
      VALUES (v_org_id, v_key.crm_version_id, 'lifetime', v_key.id, v_now, NULL)
      ON CONFLICT (organization_id) DO UPDATE
        SET crm_version_id = EXCLUDED.crm_version_id,
            license_type = EXCLUDED.license_type,
            access_key_id = EXCLUDED.access_key_id,
            activated_at = EXCLUDED.activated_at,
            expires_at = NULL;

      UPDATE access_keys
      SET status = 'consumed', organization_id = v_org_id, activated_at = v_now
      WHERE id = v_key.id;

      SELECT om.id INTO v_member_id
      FROM organization_members om
      WHERE om.organization_id = v_org_id AND om.user_id = v_user_id AND om.is_active = true
      LIMIT 1;

      IF v_member_id IS NULL THEN
        RAISE EXCEPTION 'membership missing after upgrade' USING ERRCODE = '22023';
      END IF;

      PERFORM sync_member_profile_from_auth(v_member_id);

      INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
      VALUES (v_user_id, v_org_id, v_member_id, v_now)
      ON CONFLICT (user_id) DO UPDATE
        SET organization_id = EXCLUDED.organization_id,
          member_id = EXCLUDED.member_id,
          updated_at = EXCLUDED.updated_at;

      RETURN jsonb_build_object(
        'organization_id', v_org_id, 'key_type', 'lifetime', 'status', 'licensed', 'upgraded', true
      );
    END IF;

    v_org_name := coalesce(nullif(trim(p_org_name), ''), 'Organization');
    v_slug_base := slugify_org_name(v_org_name);
    v_slug := v_slug_base;
    v_slug_suffix := 0;

    WHILE EXISTS (SELECT 1 FROM organizations o WHERE o.slug = v_slug) LOOP
      v_slug_suffix := v_slug_suffix + 1;
      v_slug := v_slug_base || '-' || v_slug_suffix::text;
    END LOOP;

    INSERT INTO organizations (name, slug, status, crm_version_id, access_key_id, owner_user_id)
    VALUES (v_org_name, v_slug, 'licensed', v_key.crm_version_id, v_key.id, v_user_id)
    RETURNING id INTO v_org_id;

    INSERT INTO organization_settings (organization_id) VALUES (v_org_id);

    INSERT INTO organization_members (organization_id, user_id, role, display_name, joined_at)
    VALUES (v_org_id, v_user_id, 'owner', split_part(v_user_email, '@', 1), v_now)
    RETURNING id INTO v_member_id;

    PERFORM sync_member_profile_from_auth(v_member_id);

    INSERT INTO organization_licenses (
      organization_id, crm_version_id, license_type, access_key_id, activated_at, expires_at
    )
    VALUES (v_org_id, v_key.crm_version_id, 'lifetime', v_key.id, v_now, NULL);

    UPDATE access_keys
    SET status = 'consumed', organization_id = v_org_id, activated_at = v_now
    WHERE id = v_key.id;

    INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
    VALUES (v_user_id, v_org_id, v_member_id, v_now)
    ON CONFLICT (user_id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          member_id = EXCLUDED.member_id,
          updated_at = EXCLUDED.updated_at;

    RETURN jsonb_build_object(
      'organization_id', v_org_id, 'key_type', 'lifetime', 'status', 'licensed', 'upgraded', false
    );
  END IF;

  RAISE EXCEPTION 'invalid access key' USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION activate_access_key(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_access_key(text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION activate_access_key(text, text, uuid) TO service_role;
