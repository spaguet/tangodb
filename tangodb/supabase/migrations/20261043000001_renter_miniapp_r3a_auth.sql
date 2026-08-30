-- R3a / 2.9.6: Mini App mint RPCs, initData hash idempotency, staff JWT inventory hardening.

BEGIN;

-- =============================================================================
-- 1. Idempotent initData hash buffer (~15 min TTL, not a second freshness gate)
-- =============================================================================

CREATE TABLE IF NOT EXISTS renter_init_data_hashes (
  init_data_hash   text PRIMARY KEY,
  organization_id  uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  telegram_id      bigint NOT NULL CHECK (telegram_id > 0),
  auth_user_id     uuid,
  renter_id        uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_renter_init_data_hashes_org_tg_created
  ON renter_init_data_hashes (organization_id, telegram_id, created_at DESC);

COMMENT ON TABLE renter_init_data_hashes IS
  'Mint idempotency by initData hash. TTL ~15 min storage buffer after auth_date window; not a second freshness check.';

ALTER TABLE renter_init_data_hashes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE renter_init_data_hashes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE renter_init_data_hashes TO service_role;

-- =============================================================================
-- 2. Staff vs renter JWT helpers (inventory)
-- =============================================================================

CREATE OR REPLACE FUNCTION _auth_is_renter_actor()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_meta jsonb;
BEGIN
  BEGIN
    v_meta := COALESCE(
      auth.jwt(),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_meta := '{}'::jsonb;
  END;

  RETURN COALESCE(v_meta -> 'app_metadata' ->> 'actor', '') = 'renter';
END;
$$;

COMMENT ON FUNCTION _auth_is_renter_actor() IS
  'True when JWT app_metadata.actor = renter. Used to fail-closed staff RPC/Storage for Mini App principal.';

CREATE OR REPLACE FUNCTION _reject_renter_staff_jwt()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF _auth_is_renter_actor() THEN
    RAISE EXCEPTION 'renters.error.forbidden' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- set_active_organization: explicit renter rejection (not verify-email path)
CREATE OR REPLACE FUNCTION set_active_organization(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_member_id uuid;
BEGIN
  PERFORM _reject_renter_staff_jwt();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT om.id
  INTO v_member_id
  FROM organization_members om
  WHERE om.user_id = v_user_id
    AND om.organization_id = p_organization_id
    AND om.is_active = true;

  IF v_member_id IS NULL THEN
    RAISE EXCEPTION 'not an active member of organization';
  END IF;

  INSERT INTO user_active_organizations (user_id, organization_id, member_id, updated_at)
  VALUES (v_user_id, p_organization_id, v_member_id, now())
  ON CONFLICT (user_id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        member_id = EXCLUDED.member_id,
        updated_at = EXCLUDED.updated_at;
END;
$$;

-- prepare_renter_document_upload: add explicit renter rejection (preserve S25 body)
CREATE OR REPLACE FUNCTION prepare_renter_document_upload(
  p_renter_id uuid,
  p_filename text,
  p_mime text,
  p_size bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_object_id uuid := gen_random_uuid();
  v_safe_name text;
  v_path text;
BEGIN
  PERFORM _reject_renter_staff_jwt();

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_documents() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r
    WHERE r.id = p_renter_id AND r.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  IF p_mime IS NULL OR NOT (p_mime = ANY (_renter_allowed_document_mimes())) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentMimeInvalid');
  END IF;

  IF p_size IS NULL OR p_size <= 0 OR p_size > _renter_document_max_bytes() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.documentSizeInvalid');
  END IF;

  v_safe_name := regexp_replace(coalesce(p_filename, 'file'), '[^a-zA-Z0-9._-]', '_', 'g');
  IF v_safe_name = '' THEN
    v_safe_name := 'file';
  END IF;

  v_path := v_org_id::text || '/' || p_renter_id::text || '/' || v_object_id::text;

  INSERT INTO renter_document_upload_intents (
    organization_id,
    renter_id,
    storage_path,
    created_by
  )
  VALUES (
    v_org_id,
    p_renter_id,
    v_path,
    v_member_id
  );

  RETURN jsonb_build_object(
    'success', true,
    'storage_path', v_path,
    'bucket', 'renter-documents',
    'object_id', v_object_id
  );
END;
$$;

-- Storage exports bucket: uid-only insert was a renter JWT hole
DROP POLICY IF EXISTS exports_insert_own ON storage.objects;

CREATE POLICY exports_insert_own
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'exports'
  AND NOT _auth_is_renter_actor()
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- =============================================================================
-- 3. Mint advisory lock key (org + telegram_id)
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_mint_lock_key(p_org uuid, p_telegram_id bigint)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ('x' || substr(md5(p_org::text || ':' || p_telegram_id::text || ':renter_mint'), 1, 16))::bit(64)::bigint;
$$;

-- =============================================================================
-- 4. Channel lookup for mint (service_role / Edge only)
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_mint_channel(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row organization_renter_channel%ROWTYPE;
BEGIN
  IF p_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = p_org_id) THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  SELECT * INTO v_row
  FROM organization_renter_channel c
  WHERE c.organization_id = p_org_id;

  IF NOT FOUND OR v_row.encrypted_bot_token IS NULL THEN
    RETURN jsonb_build_object('success', false);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'encrypted_bot_token_hex', encode(v_row.encrypted_bot_token, 'hex')
  );
END;
$$;

REVOKE ALL ON FUNCTION renter_telegram_mint_channel(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION renter_telegram_mint_channel(uuid) TO service_role;

-- =============================================================================
-- 5. Mint prepare: upsert renter card, dialog allows_write, hash row
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_mint_prepare(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_telegram bigint;
  v_display_name text;
  v_init_hash text;
  v_allows_write boolean;
  v_renter_id uuid;
  v_auth_user_id uuid;
  v_status text;
  v_existed boolean := false;
  v_addon_active boolean;
  v_hash_row renter_init_data_hashes%ROWTYPE;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  BEGIN
    v_telegram := NULLIF(p_payload ->> 'telegram_id', '')::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END;
  v_display_name := left(
    regexp_replace(
      trim(COALESCE(p_payload ->> 'display_name', '')),
      '[[:cntrl:]]',
      '',
      'g'
    ),
    80
  );
  v_init_hash := NULLIF(trim(COALESCE(p_payload ->> 'init_data_hash', '')), '');
  v_allows_write := COALESCE((p_payload ->> 'allows_write_to_pm')::boolean, false);

  IF v_org IS NULL OR v_telegram IS NULL OR v_telegram <= 0 OR v_init_hash IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  IF v_display_name = '' THEN
    v_display_name := 'Telegram user';
  END IF;

  PERFORM pg_advisory_xact_lock(_renter_mint_lock_key(v_org, v_telegram));

  SELECT *
  INTO v_hash_row
  FROM renter_init_data_hashes h
  WHERE h.init_data_hash = v_init_hash
    AND h.organization_id = v_org
    AND h.created_at > now() - interval '15 minutes';

  IF FOUND THEN
    SELECT r.id, r.auth_user_id, r.status
    INTO v_renter_id, v_auth_user_id, v_status
    FROM renters r
    WHERE r.id = v_hash_row.renter_id
      AND r.organization_id = v_org
      AND r.telegram_id = v_telegram;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'renter_id', v_renter_id,
      'auth_user_id', v_auth_user_id,
      'needs_create_user', v_auth_user_id IS NULL,
      'is_new_renter', false,
      'status', v_status,
      'idempotent', true
    );
  END IF;

  IF NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  SELECT r.id, r.auth_user_id, r.status
  INTO v_renter_id, v_auth_user_id, v_status
  FROM renters r
  WHERE r.organization_id = v_org
    AND r.telegram_id = v_telegram;

  v_existed := FOUND;

  v_addon_active := renter_miniapp_addon_is_active(v_org);

  IF NOT v_existed AND NOT v_addon_active THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
  END IF;

  IF NOT v_existed THEN
    INSERT INTO renters (
      organization_id,
      display_name,
      telegram_id,
      counterparty_type,
      status
    )
    VALUES (
      v_org,
      v_display_name,
      v_telegram,
      'individual',
      'active'
    )
    RETURNING id, auth_user_id, status
    INTO v_renter_id, v_auth_user_id, v_status;
  END IF;

  IF v_allows_write THEN
    INSERT INTO renter_telegram_dialog (
      organization_id,
      telegram_id,
      allows_write_to_pm,
      updated_at
    )
    VALUES (v_org, v_telegram, true, now())
    ON CONFLICT (organization_id, telegram_id) DO UPDATE SET
      allows_write_to_pm = true,
      updated_at = now();
  END IF;

  INSERT INTO renter_init_data_hashes (
    init_data_hash,
    organization_id,
    telegram_id,
    auth_user_id,
    renter_id
  )
  VALUES (
    v_init_hash,
    v_org,
    v_telegram,
    v_auth_user_id,
    v_renter_id
  )
  ON CONFLICT (init_data_hash) DO UPDATE SET
    auth_user_id = EXCLUDED.auth_user_id,
    renter_id = EXCLUDED.renter_id,
    created_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'renter_id', v_renter_id,
    'auth_user_id', v_auth_user_id,
    'needs_create_user', v_auth_user_id IS NULL,
    'is_new_renter', NOT v_existed,
    'status', v_status,
    'idempotent', false
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.auth.forbidden');
END;
$$;

REVOKE ALL ON FUNCTION renter_telegram_mint_prepare(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION renter_telegram_mint_prepare(jsonb) TO service_role;

-- =============================================================================
-- 6. Bind auth_user_id after Edge createUser (race-safe)
-- =============================================================================

CREATE OR REPLACE FUNCTION renter_telegram_mint_bind_auth(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid;
  v_telegram bigint;
  v_auth_user_id uuid;
  v_updated integer;
BEGIN
  v_org := NULLIF(p_payload ->> 'organization_id', '')::uuid;
  BEGIN
    v_telegram := NULLIF(p_payload ->> 'telegram_id', '')::bigint;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('success', false, 'bound', false);
  END;
  v_auth_user_id := NULLIF(p_payload ->> 'auth_user_id', '')::uuid;

  IF v_org IS NULL OR v_telegram IS NULL OR v_telegram <= 0 OR v_auth_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'bound', false);
  END IF;

  PERFORM pg_advisory_xact_lock(_renter_mint_lock_key(v_org, v_telegram));

  UPDATE renters
  SET auth_user_id = v_auth_user_id
  WHERE organization_id = v_org
    AND telegram_id = v_telegram
    AND auth_user_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    UPDATE renter_init_data_hashes
    SET auth_user_id = v_auth_user_id
    WHERE organization_id = v_org
      AND telegram_id = v_telegram
      AND created_at > now() - interval '15 minutes';
  END IF;

  RETURN jsonb_build_object('success', v_updated = 1, 'bound', v_updated = 1);
END;
$$;

REVOKE ALL ON FUNCTION renter_telegram_mint_bind_auth(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION renter_telegram_mint_bind_auth(jsonb) TO service_role;

-- Prune stale hash rows (best-effort, called from mint)
CREATE OR REPLACE FUNCTION _renter_prune_init_data_hashes()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  DELETE FROM renter_init_data_hashes
  WHERE created_at < now() - interval '15 minutes';
$$;

REVOKE ALL ON FUNCTION _renter_prune_init_data_hashes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION _renter_prune_init_data_hashes() TO service_role;

COMMIT;
