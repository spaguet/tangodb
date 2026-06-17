-- TangoDB v2 Phase 1A (A-1, A-2): tenant core + licensing tables
-- Greenfield schema — business tables added in Phase 2

-- =============================================================================
-- 1. CRM product versions
-- =============================================================================

CREATE TABLE crm_product_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  schema_version      INT NOT NULL CHECK (schema_version >= 1),
  app_url             TEXT NOT NULL,
  min_client_version  TEXT,
  is_current          BOOLEAN NOT NULL DEFAULT false,
  released_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deprecated_at       TIMESTAMPTZ
);

INSERT INTO crm_product_versions (code, name, schema_version, app_url, is_current, released_at)
VALUES
  ('v2', 'TangoDB CRM v2', 2, 'https://tangodb.vercel.app', true, now()),
  ('v1_legacy', 'TangoDB CRM v1 (legacy)', 1, 'https://v1.tangodb.vercel.app', false, now());

-- =============================================================================
-- 2. Organizations (access_key_id added after access_keys)
-- =============================================================================

CREATE TABLE organizations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL,
  slug                  TEXT UNIQUE,
  status                TEXT NOT NULL DEFAULT 'demo_active'
    CHECK (status IN ('demo_active', 'demo_retention', 'licensed', 'suspended', 'purged')),
  crm_version_id        UUID NOT NULL REFERENCES crm_product_versions (id),
  demo_activated_at     TIMESTAMPTZ,
  demo_expires_at       TIMESTAMPTZ,
  data_purge_at         TIMESTAMPTZ,
  schema_version_locked BOOLEAN NOT NULL DEFAULT false,
  owner_user_id         UUID REFERENCES auth.users (id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 3. Access keys
-- =============================================================================

CREATE TABLE access_keys (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash          TEXT NOT NULL UNIQUE,
  key_type          TEXT NOT NULL CHECK (key_type IN ('demo', 'lifetime')),
  status            TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'consumed', 'revoked')),
  crm_version_id    UUID NOT NULL REFERENCES crm_product_versions (id),
  email             TEXT,
  organization_id   UUID REFERENCES organizations (id),
  activated_at      TIMESTAMPTZ,
  demo_expires_at   TIMESTAMPTZ,
  data_purge_at     TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users (id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at        TIMESTAMPTZ
);

ALTER TABLE organizations
  ADD COLUMN access_key_id UUID REFERENCES access_keys (id);

CREATE UNIQUE INDEX idx_access_keys_demo_email
  ON access_keys (lower(email))
  WHERE key_type = 'demo';

-- =============================================================================
-- 4. Organization members
-- =============================================================================

CREATE TABLE organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role            TEXT NOT NULL
    CHECK (role IN ('owner', 'director', 'admin', 'teacher', 'accountant')),
  scope           JSONB NOT NULL DEFAULT '{
    "discipline_ids": [],
    "location_ids": [],
    "all_disciplines": false,
    "all_locations": false,
    "can_view_all_clients": false
  }'::jsonb,
  display_name    TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  invited_at      TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, user_id),
  CHECK (jsonb_typeof(scope) = 'object')
);

-- =============================================================================
-- 5. Organization settings
-- =============================================================================

CREATE TABLE organization_settings (
  organization_id               UUID PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  locale                        TEXT NOT NULL DEFAULT 'ru-RU',
  currency_code                 TEXT NOT NULL DEFAULT 'RUB'
    CHECK (currency_code ~ '^[A-Z]{3}$'),
  currency_display              TEXT NOT NULL DEFAULT 'symbol'
    CHECK (currency_display IN ('symbol', 'code')),
  timezone                      TEXT NOT NULL DEFAULT 'Europe/Moscow',
  week_starts_on                INT NOT NULL DEFAULT 1
    CHECK (week_starts_on BETWEEN 1 AND 7),
  org_preset                    TEXT NOT NULL DEFAULT 'dance_school',
  terminology                   JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(terminology) = 'object'),
  modules                       JSONB NOT NULL DEFAULT '{
    "group_subscriptions": true,
    "personal_lessons": true,
    "pair_subscriptions": true,
    "trio_lessons": true,
    "multi_discipline": true,
    "locations": true
  }'::jsonb
    CHECK (jsonb_typeof(modules) = 'object'),
  freeze_max_count              INT NOT NULL DEFAULT 1 CHECK (freeze_max_count >= 0),
  freeze_min_lessons            INT NOT NULL DEFAULT 8 CHECK (freeze_min_lessons >= 0),
  freeze_deducts_lesson         BOOLEAN NOT NULL DEFAULT true,
  low_balance_threshold         INT NOT NULL DEFAULT 2 CHECK (low_balance_threshold >= 0),
  teachers_can_manage_disciplines BOOLEAN NOT NULL DEFAULT false,
  pair_cycle_enabled            BOOLEAN NOT NULL DEFAULT true,
  branding_name                 TEXT,
  branding_logo_url             TEXT,
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 6. Active organization (JWT hook source of truth)
-- =============================================================================

CREATE TABLE user_active_organizations (
  user_id         UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id       UUID NOT NULL REFERENCES organization_members (id) ON DELETE CASCADE,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 7. Organization licenses
-- =============================================================================

CREATE TABLE organization_licenses (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL UNIQUE REFERENCES organizations (id) ON DELETE CASCADE,
  crm_version_id   UUID NOT NULL REFERENCES crm_product_versions (id),
  license_type     TEXT NOT NULL CHECK (license_type IN ('lifetime', 'subscription')),
  access_key_id    UUID REFERENCES access_keys (id),
  activated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ
);

-- =============================================================================
-- 8. Platform audit log (Dev Console)
-- =============================================================================

CREATE TABLE platform_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users (id),
  action        TEXT NOT NULL,
  target_type   TEXT NOT NULL,
  target_id     UUID,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(metadata) = 'object'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 9. Indexes (tenant core — §7.4 subset)
-- =============================================================================

CREATE INDEX idx_members_user ON organization_members (user_id) WHERE is_active;
CREATE INDEX idx_members_org_role ON organization_members (organization_id, role) WHERE is_active;
CREATE INDEX idx_active_org_user ON user_active_organizations (user_id);
CREATE INDEX idx_access_keys_org ON access_keys (organization_id) WHERE organization_id IS NOT NULL;
CREATE INDEX idx_access_keys_purge ON access_keys (data_purge_at)
  WHERE key_type = 'demo' AND status = 'active';
CREATE INDEX idx_organizations_purge ON organizations (data_purge_at)
  WHERE status = 'demo_retention';
CREATE INDEX idx_organizations_status ON organizations (status);
CREATE INDEX idx_org_licenses_org ON organization_licenses (organization_id);
