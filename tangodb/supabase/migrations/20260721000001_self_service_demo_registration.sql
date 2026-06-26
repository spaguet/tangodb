-- S1: Self-service demo registration (email + Turnstile + recovery code)
-- pgcrypto on Supabase lives in schema `extensions` (pre-enabled).

-- =============================================================================
-- 1. Anti-abuse retention registry (no public read)
-- =============================================================================

CREATE TABLE demo_owner_retention (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email_hash  TEXT NOT NULL,
  telegram_id_hash  TEXT,
  first_demo_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  purged_at         TIMESTAMPTZ,
  payment_ref       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_demo_owner_retention_email_hash
  ON demo_owner_retention (owner_email_hash);

CREATE INDEX idx_demo_owner_retention_purged
  ON demo_owner_retention (purged_at)
  WHERE purged_at IS NOT NULL;

ALTER TABLE demo_owner_retention ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. Emergency recovery codes (hash only, service role write)
-- =============================================================================

CREATE TABLE user_recovery_codes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  code_hash    TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ,
  shown_at     TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_user_recovery_codes_active_user
  ON user_recovery_codes (user_id)
  WHERE revoked_at IS NULL;

ALTER TABLE user_recovery_codes ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 3. Turnstile-verified registration challenges (email hash, short TTL)
-- =============================================================================

CREATE TABLE self_service_demo_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email_hash TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ
);

CREATE INDEX idx_self_service_demo_challenges_email
  ON self_service_demo_challenges (owner_email_hash, created_at DESC);

CREATE INDEX idx_self_service_demo_challenges_expires
  ON self_service_demo_challenges (expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE self_service_demo_challenges ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION owner_email_hash(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(lower(trim(coalesce(p_email, ''))), 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION owner_email_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_email_hash(text) TO service_role;

CREATE OR REPLACE FUNCTION consume_self_service_demo_challenge(p_email_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT c.id
  INTO v_id
  FROM self_service_demo_challenges c
  WHERE c.owner_email_hash = p_email_hash
    AND c.consumed_at IS NULL
    AND c.expires_at > now()
  ORDER BY c.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE self_service_demo_challenges
  SET consumed_at = now()
  WHERE id = v_id;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION consume_self_service_demo_challenge(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION consume_self_service_demo_challenge(text) TO service_role;

-- =============================================================================
-- 5. create_self_service_demo_org — demo org without access key
-- =============================================================================

CREATE OR REPLACE FUNCTION create_self_service_demo_org(
  p_user_id uuid,
  p_display_name text,
  p_email_hash text,
  p_recovery_code_hash text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_email text;
  v_email_confirmed timestamptz;
  v_org_id uuid;
  v_member_id uuid;
  v_slug text;
  v_slug_base text;
  v_slug_suffix int := 0;
  v_display_name text;
  v_current_version_id uuid;
  v_now timestamptz := now();
  v_demo_expires timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id required' USING ERRCODE = '22023';
  END IF;

  IF p_email_hash IS NULL OR length(trim(p_email_hash)) = 0 THEN
    RAISE EXCEPTION 'email_hash required' USING ERRCODE = '22023';
  END IF;

  SELECT u.email, u.email_confirmed_at
  INTO v_user_email, v_email_confirmed
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_user_email IS NULL OR trim(v_user_email) = '' THEN
    RAISE EXCEPTION 'email required' USING ERRCODE = '22023';
  END IF;

  IF v_email_confirmed IS NULL THEN
    RAISE EXCEPTION 'email not confirmed' USING ERRCODE = '22023';
  END IF;

  IF owner_email_hash(v_user_email) IS DISTINCT FROM p_email_hash THEN
    RAISE EXCEPTION 'email hash mismatch' USING ERRCODE = '22023';
  END IF;

  IF NOT consume_self_service_demo_challenge(p_email_hash) THEN
    RAISE EXCEPTION 'turnstile challenge missing or expired' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM demo_owner_retention r WHERE r.owner_email_hash = p_email_hash
  ) THEN
    RAISE EXCEPTION 'demo already used for this email' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM access_keys ak
    WHERE ak.key_type = 'demo'
      AND ak.email IS NOT NULL
      AND lower(trim(ak.email)) = lower(trim(v_user_email))
  ) THEN
    RAISE EXCEPTION 'demo already used for this email' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM organization_members om
    WHERE om.user_id = p_user_id
      AND om.is_active = true
  ) THEN
    RAISE EXCEPTION 'user already has organization membership' USING ERRCODE = '22023';
  END IF;

  v_current_version_id := current_crm_version_id();
  IF v_current_version_id IS NULL THEN
    RAISE EXCEPTION 'crm version not configured' USING ERRCODE = '22023';
  END IF;

  v_display_name := coalesce(
    nullif(trim(p_display_name), ''),
    nullif(trim(v_user_email), ''),
    'Owner'
  );

  v_slug_base := slugify_org_name('Demo Organization');
  v_slug := v_slug_base;
  WHILE EXISTS (SELECT 1 FROM organizations o WHERE o.slug = v_slug) LOOP
    v_slug_suffix := v_slug_suffix + 1;
    v_slug := v_slug_base || '-' || v_slug_suffix::text;
  END LOOP;

  v_demo_expires := v_now + interval '30 days';

  INSERT INTO organizations (
    name,
    slug,
    status,
    crm_version_id,
    demo_activated_at,
    demo_expires_at,
    data_purge_at,
    owner_user_id
  )
  VALUES (
    'Demo Organization',
    v_slug,
    'demo_active',
    v_current_version_id,
    v_now,
    v_demo_expires,
    v_demo_expires,
    p_user_id
  )
  RETURNING id INTO v_org_id;

  INSERT INTO organization_settings (organization_id)
  VALUES (v_org_id);

  INSERT INTO organization_members (organization_id, user_id, role, display_name, joined_at)
  VALUES (v_org_id, p_user_id, 'owner', v_display_name, v_now)
  RETURNING id INTO v_member_id;

  INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
  VALUES (p_user_id, v_org_id, v_member_id, v_now)
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        member_id = EXCLUDED.member_id,
        updated_at = EXCLUDED.updated_at;

  IF p_recovery_code_hash IS NOT NULL AND length(trim(p_recovery_code_hash)) > 0 THEN
    UPDATE user_recovery_codes
    SET revoked_at = v_now
    WHERE user_id = p_user_id
      AND revoked_at IS NULL;

    INSERT INTO user_recovery_codes (user_id, code_hash, shown_at)
    VALUES (p_user_id, p_recovery_code_hash, NULL);
  END IF;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_user_id,
    'demo.self_service_created',
    'organization',
    v_org_id,
    jsonb_build_object(
      'source', 'email',
      'demo_expires_at', v_demo_expires
    )
  );

  RETURN jsonb_build_object(
    'organization_id', v_org_id,
    'status', 'demo_active',
    'demo_expires_at', v_demo_expires
  );
END;
$$;

REVOKE ALL ON FUNCTION create_self_service_demo_org(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_self_service_demo_org(uuid, text, text, text) TO service_role;
