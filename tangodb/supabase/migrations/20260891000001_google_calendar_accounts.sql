-- Google Calendar integration — OAuth accounts, bindings, OAuth handshake state (GCAL Prompt 1)

BEGIN;

-- =============================================================================
-- 1. user_google_accounts (backend-only credentials)
-- =============================================================================

CREATE TABLE user_google_accounts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  google_subject          TEXT NOT NULL,
  google_email            TEXT NOT NULL,
  encrypted_refresh_token BYTEA,
  granted_scopes          TEXT[] NOT NULL DEFAULT '{}'::text[],
  status                  TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'error')),
  token_version           INT NOT NULL DEFAULT 1 CHECK (token_version >= 1),
  last_verified_at        TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, google_subject),
  UNIQUE (google_subject)
);

CREATE INDEX idx_user_google_accounts_user_id
  ON user_google_accounts (user_id);

ALTER TABLE user_google_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE user_google_accounts FROM PUBLIC;
REVOKE ALL ON TABLE user_google_accounts FROM anon;
REVOKE ALL ON TABLE user_google_accounts FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_google_accounts TO service_role;

CREATE OR REPLACE FUNCTION list_my_google_accounts()
RETURNS TABLE (
  id uuid,
  google_email text,
  status text,
  granted_scopes text[],
  last_verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    uga.id,
    uga.google_email,
    uga.status,
    uga.granted_scopes,
    uga.last_verified_at,
    uga.created_at,
    uga.updated_at
  FROM user_google_accounts uga
  WHERE uga.user_id = auth.uid()
  ORDER BY uga.created_at;
$$;

REVOKE ALL ON FUNCTION list_my_google_accounts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_my_google_accounts() TO authenticated;

-- =============================================================================
-- 2. google_oauth_states (backend-only OAuth handshake)
-- =============================================================================

CREATE TABLE google_oauth_states (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash      TEXT NOT NULL UNIQUE,
  user_id         UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  oidc_nonce      TEXT NOT NULL,
  pkce_verifier   TEXT NOT NULL,
  return_url      TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  consumed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_google_oauth_states_expires_at
  ON google_oauth_states (expires_at)
  WHERE consumed_at IS NULL;

CREATE INDEX idx_google_oauth_states_user_pending
  ON google_oauth_states (user_id, expires_at)
  WHERE consumed_at IS NULL;

ALTER TABLE google_oauth_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE google_oauth_states FROM PUBLIC;
REVOKE ALL ON TABLE google_oauth_states FROM anon;
REVOKE ALL ON TABLE google_oauth_states FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON google_oauth_states TO service_role;

-- =============================================================================
-- 3. member_google_calendar_bindings
-- =============================================================================

CREATE TABLE member_google_calendar_bindings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  organization_member_id  UUID NOT NULL,
  google_account_id       UUID NOT NULL REFERENCES user_google_accounts (id) ON DELETE RESTRICT,
  calendar_id             TEXT NOT NULL,
  calendar_name           TEXT NOT NULL,
  timezone                TEXT NOT NULL,
  enabled                 BOOLEAN NOT NULL DEFAULT true,
  sync_group              BOOLEAN NOT NULL DEFAULT false,
  sync_personal           BOOLEAN NOT NULL DEFAULT false,
  sync_events             BOOLEAN NOT NULL DEFAULT false,
  privacy_mode            TEXT NOT NULL DEFAULT 'initials'
    CHECK (privacy_mode IN ('full_name', 'initials', 'hidden')),
  last_success_at         TIMESTAMPTZ,
  last_error_at           TIMESTAMPTZ,
  last_error_code         TEXT,
  disabled_at             TIMESTAMPTZ,
  cleanup_pending         BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, organization_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_member_gcal_bindings_one_active_per_member
  ON member_google_calendar_bindings (organization_id, organization_member_id)
  WHERE enabled;

CREATE INDEX idx_member_gcal_bindings_org_member
  ON member_google_calendar_bindings (organization_id, organization_member_id);

CREATE INDEX idx_member_gcal_bindings_google_account
  ON member_google_calendar_bindings (google_account_id);

CREATE OR REPLACE FUNCTION member_google_calendar_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
DECLARE
  v_member_user_id uuid;
  v_account_user_id uuid;
BEGIN
  SELECT om.user_id
  INTO v_member_user_id
  FROM organization_members om
  WHERE om.id = NEW.organization_member_id
    AND om.organization_id = NEW.organization_id;

  IF v_member_user_id IS NULL THEN
    RAISE EXCEPTION 'organization_member_not_found';
  END IF;

  SELECT uga.user_id
  INTO v_account_user_id
  FROM user_google_accounts uga
  WHERE uga.id = NEW.google_account_id;

  IF v_account_user_id IS NULL THEN
    RAISE EXCEPTION 'google_account_not_found';
  END IF;

  IF v_member_user_id <> v_account_user_id THEN
    RAISE EXCEPTION 'google_account_member_mismatch';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER member_google_calendar_binding_guard_trg
  BEFORE INSERT OR UPDATE OF organization_id, organization_member_id, google_account_id
  ON member_google_calendar_bindings
  FOR EACH ROW
  EXECUTE FUNCTION member_google_calendar_binding_guard();

ALTER TABLE member_google_calendar_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY member_gcal_bindings_select_self
  ON member_google_calendar_bindings FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND organization_member_id = auth_member_id()
    AND business_row_readable()
  );

CREATE POLICY member_gcal_bindings_select_management
  ON member_google_calendar_bindings FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director')
  );

GRANT SELECT ON member_google_calendar_bindings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON member_google_calendar_bindings TO service_role;

-- =============================================================================
-- 4. organization_google_calendar_bindings (org-level events calendar)
-- =============================================================================

CREATE TABLE organization_google_calendar_bindings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  google_account_id         UUID NOT NULL REFERENCES user_google_accounts (id) ON DELETE RESTRICT,
  configured_by_member_id   UUID NOT NULL,
  calendar_id               TEXT NOT NULL,
  calendar_name             TEXT NOT NULL,
  timezone                  TEXT NOT NULL,
  enabled                   BOOLEAN NOT NULL DEFAULT true,
  disabled_at               TIMESTAMPTZ,
  cleanup_pending           BOOLEAN NOT NULL DEFAULT false,
  last_success_at           TIMESTAMPTZ,
  last_error_at             TIMESTAMPTZ,
  last_error_code           TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, configured_by_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_org_gcal_bindings_one_active_per_org
  ON organization_google_calendar_bindings (organization_id)
  WHERE enabled;

CREATE INDEX idx_org_gcal_bindings_org
  ON organization_google_calendar_bindings (organization_id);

CREATE INDEX idx_org_gcal_bindings_google_account
  ON organization_google_calendar_bindings (google_account_id);

CREATE OR REPLACE FUNCTION organization_google_calendar_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
DECLARE
  v_configurator_user_id uuid;
  v_account_user_id uuid;
BEGIN
  SELECT om.user_id
  INTO v_configurator_user_id
  FROM organization_members om
  WHERE om.id = NEW.configured_by_member_id
    AND om.organization_id = NEW.organization_id;

  IF v_configurator_user_id IS NULL THEN
    RAISE EXCEPTION 'configured_by_member_not_found';
  END IF;

  SELECT uga.user_id
  INTO v_account_user_id
  FROM user_google_accounts uga
  WHERE uga.id = NEW.google_account_id;

  IF v_account_user_id IS NULL THEN
    RAISE EXCEPTION 'google_account_not_found';
  END IF;

  IF v_configurator_user_id <> v_account_user_id THEN
    RAISE EXCEPTION 'google_account_configurator_mismatch';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER organization_google_calendar_binding_guard_trg
  BEFORE INSERT OR UPDATE OF organization_id, configured_by_member_id, google_account_id
  ON organization_google_calendar_bindings
  FOR EACH ROW
  EXECUTE FUNCTION organization_google_calendar_binding_guard();

ALTER TABLE organization_google_calendar_bindings ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_gcal_bindings_select_management
  ON organization_google_calendar_bindings FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() IN ('owner', 'director')
  );

GRANT SELECT ON organization_google_calendar_bindings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_google_calendar_bindings TO service_role;

-- Audit connect/disconnect/calendar change: Edge Functions in Prompt 2 (no generic audit trigger here).

COMMIT;
