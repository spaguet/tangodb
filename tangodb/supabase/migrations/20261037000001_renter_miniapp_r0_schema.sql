-- R0 / 2.9.0: Mini App renter self-service schema skeleton.
-- channel/lifecycle/telegram_id/hour rates/addons/hook actor=renter.
-- Not: ledger, FIFO, worker, request_kind, renter_telegram_dialog.

BEGIN;

-- =============================================================================
-- 1. renters: telegram identity, GoTrue link, reliability columns, display_name ≤ 80
-- =============================================================================

UPDATE renters
SET display_name = left(display_name, 80)
WHERE char_length(display_name) > 80;

ALTER TABLE renters
  ADD COLUMN IF NOT EXISTS telegram_id bigint,
  ADD COLUMN IF NOT EXISTS auth_user_id uuid,
  ADD COLUMN IF NOT EXISTS booking_banned_at timestamptz,
  ADD COLUMN IF NOT EXISTS on_time_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS untimely_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_tariff_applied_at timestamptz;

ALTER TABLE renters
  DROP CONSTRAINT IF EXISTS renters_telegram_id_positive_chk,
  DROP CONSTRAINT IF EXISTS renters_display_name_max_len_chk,
  DROP CONSTRAINT IF EXISTS renters_on_time_count_nonneg_chk,
  DROP CONSTRAINT IF EXISTS renters_untimely_count_nonneg_chk;

ALTER TABLE renters
  ADD CONSTRAINT renters_telegram_id_positive_chk
    CHECK (telegram_id IS NULL OR telegram_id > 0),
  ADD CONSTRAINT renters_display_name_max_len_chk
    CHECK (char_length(display_name) <= 80),
  ADD CONSTRAINT renters_on_time_count_nonneg_chk
    CHECK (on_time_count >= 0),
  ADD CONSTRAINT renters_untimely_count_nonneg_chk
    CHECK (untimely_count >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS renters_org_telegram_id_unique
  ON renters (organization_id, telegram_id)
  WHERE telegram_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS renters_auth_user_id_unique
  ON renters (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'renters_auth_user_id_fkey'
  ) THEN
    ALTER TABLE renters
      ADD CONSTRAINT renters_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users (id) ON DELETE SET NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION renters_revoke_auth_on_identity_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       OLD.telegram_id IS DISTINCT FROM NEW.telegram_id
       OR OLD.auth_user_id IS DISTINCT FROM NEW.auth_user_id
     )
     AND OLD.auth_user_id IS NOT NULL
  THEN
    PERFORM revoke_auth_sessions_for_user(OLD.auth_user_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS renters_revoke_auth_on_identity_change_trg ON renters;

CREATE TRIGGER renters_revoke_auth_on_identity_change_trg
  AFTER UPDATE OF telegram_id, auth_user_id ON renters
  FOR EACH ROW
  EXECUTE FUNCTION renters_revoke_auth_on_identity_change();

COMMENT ON COLUMN renters.telegram_id IS
  'Telegram user.id (bigint). Partial unique per org; NULL = cashier-only card.';
COMMENT ON COLUMN renters.auth_user_id IS
  'GoTrue user for Mini App JWT; unique; NULL until first mint.';

-- =============================================================================
-- 2. rentals: channel + Mini App lifecycle (do not invent paid_amount/payment_status)
-- =============================================================================

ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'cashier',
  ADD COLUMN IF NOT EXISTS lifecycle text,
  ADD COLUMN IF NOT EXISTS hold_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS prepay_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS remainder_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS debt_amount numeric(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepay_charged_at timestamptz,
  ADD COLUMN IF NOT EXISTS remainder_charged_at timestamptz;

ALTER TABLE rentals
  DROP CONSTRAINT IF EXISTS rentals_channel_chk,
  DROP CONSTRAINT IF EXISTS rentals_channel_lifecycle_chk,
  DROP CONSTRAINT IF EXISTS rentals_miniapp_amounts_nonneg_chk;

ALTER TABLE rentals
  ADD CONSTRAINT rentals_channel_chk
    CHECK (channel IN ('cashier', 'miniapp')),
  ADD CONSTRAINT rentals_channel_lifecycle_chk
    CHECK (
      (channel = 'cashier') = (lifecycle IS NULL)
      AND (
        channel = 'cashier'
        OR lifecycle IN (
          'awaiting_payment',
          'active',
          'prepaid_charged',
          'settled',
          'debt',
          'cancelled',
          'auto_deleted',
          'hold_deleted'
        )
      )
    ),
  ADD CONSTRAINT rentals_miniapp_amounts_nonneg_chk
    CHECK (
      prepay_amount >= 0
      AND remainder_amount >= 0
      AND debt_amount >= 0
    );

COMMENT ON COLUMN rentals.channel IS
  'cashier = hall-rent 2.5; miniapp = renter self-service. Not organization_renter_channel.';
COMMENT ON COLUMN rentals.lifecycle IS
  'Mini App money/hold phase; NULL iff channel = cashier.';

-- =============================================================================
-- 3. rental_series: channel; cashier still requires tariff_id; miniapp tariff_id NULL
-- =============================================================================

ALTER TABLE rental_series
  ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'cashier';

ALTER TABLE rental_series
  ALTER COLUMN tariff_id DROP NOT NULL;

ALTER TABLE rental_series
  DROP CONSTRAINT IF EXISTS rental_series_channel_chk,
  DROP CONSTRAINT IF EXISTS rental_series_channel_tariff_chk;

ALTER TABLE rental_series
  ADD CONSTRAINT rental_series_channel_chk
    CHECK (channel IN ('cashier', 'miniapp')),
  ADD CONSTRAINT rental_series_channel_tariff_chk
    CHECK (
      (channel = 'cashier' AND tariff_id IS NOT NULL)
      OR (channel = 'miniapp' AND tariff_id IS NULL)
    );

-- =============================================================================
-- 4. locations.miniapp_enabled
-- =============================================================================

ALTER TABLE locations
  ADD COLUMN IF NOT EXISTS miniapp_enabled boolean NOT NULL DEFAULT false;

-- =============================================================================
-- 5. location_rental_hour_rates (no GRANT SELECT authenticated)
-- =============================================================================

CREATE TABLE IF NOT EXISTS location_rental_hour_rates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  location_id     uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('one_time', 'recurring', 'penalty')),
  price           numeric(12, 2) NOT NULL CHECK (price >= 0),
  currency        text NOT NULL,
  valid_from      date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_location_rental_hour_rates_lookup
  ON location_rental_hour_rates (organization_id, location_id, kind, valid_from DESC, created_at DESC);

CREATE OR REPLACE FUNCTION location_rental_hour_rates_set_org_currency()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_currency text;
BEGIN
  SELECT os.currency_code
  INTO v_currency
  FROM organization_settings os
  WHERE os.organization_id = NEW.organization_id;

  NEW.currency := COALESCE(v_currency, NEW.currency, 'RUB');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS location_rental_hour_rates_set_org_currency_trg ON location_rental_hour_rates;

CREATE TRIGGER location_rental_hour_rates_set_org_currency_trg
  BEFORE INSERT OR UPDATE ON location_rental_hour_rates
  FOR EACH ROW
  EXECUTE FUNCTION location_rental_hour_rates_set_org_currency();

ALTER TABLE location_rental_hour_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS location_rental_hour_rates_write ON location_rental_hour_rates;
CREATE POLICY location_rental_hour_rates_write ON location_rental_hour_rates
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = auth_organization_id()
    AND can_manage_settings()
  );

REVOKE ALL ON TABLE location_rental_hour_rates FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE location_rental_hour_rates TO service_role;

COMMENT ON TABLE location_rental_hour_rates IS
  'Mini App hour rates (one_time/recurring/penalty). Price change = INSERT. Staff CRUD via RPC (R1d); no table SELECT for JWT.';

-- =============================================================================
-- 6. organization_addons (addon_code renter_miniapp; not request_kind)
-- =============================================================================

CREATE TABLE IF NOT EXISTS organization_addons (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  addon_code      text NOT NULL CHECK (addon_code IN ('renter_miniapp')),
  status          text NOT NULL CHECK (status IN ('active', 'paused')),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, addon_code),
  CHECK (period_end >= period_start)
);

ALTER TABLE organization_addons ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE organization_addons FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE organization_addons TO service_role;

CREATE OR REPLACE FUNCTION renter_miniapp_addon_is_active(p_org uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_jwt jsonb;
  v_today date;
  v_renter_org uuid;
  v_actor text;
  v_uid uuid;
  v_visible boolean;
BEGIN
  IF p_org IS NULL THEN
    RETURN false;
  END IF;

  BEGIN
    v_jwt := COALESCE(
      auth.jwt(),
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  EXCEPTION WHEN invalid_text_representation THEN
    v_jwt := '{}'::jsonb;
  END;

  v_uid := auth.uid();
  v_actor := COALESCE(v_jwt -> 'app_metadata' ->> 'actor', '');

  BEGIN
    v_renter_org := NULLIF(v_jwt -> 'app_metadata' ->> 'organization_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_renter_org := NULL;
  END;

  -- JWT present (member or renter): only own org. No JWT = worker/service_role/SQL.
  IF v_uid IS NOT NULL OR v_actor = 'renter' THEN
    v_visible :=
      auth_organization_id() = p_org
      OR (v_actor = 'renter' AND v_renter_org = p_org);

    -- NULL from missing member org claim must not pass IF NOT (SQL three-valued logic).
    IF v_visible IS NOT TRUE THEN
      RETURN false;
    END IF;
  END IF;

  v_today := _org_local_date(p_org);

  RETURN EXISTS (
    SELECT 1
    FROM organization_addons a
    WHERE a.organization_id = p_org
      AND a.addon_code = 'renter_miniapp'
      AND a.status = 'active'
      AND a.period_start <= v_today
      AND a.period_end >= v_today
  );
END;
$$;

REVOKE ALL ON FUNCTION renter_miniapp_addon_is_active(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION renter_miniapp_addon_is_active(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION renter_miniapp_addon_is_active(uuid) IS
  'Fail-closed Mini App add-on: active status AND period covers org-local today. Authenticated callers only see own org (member claim or renter app_metadata). No row / paused / period miss = false.';

COMMENT ON TABLE organization_addons IS
  'Paid add-ons. addon_code=renter_miniapp (not platform_purchase_requests.request_kind). Written by Dev Console / service_role (R6).';

-- =============================================================================
-- 7. currency / timezone guards (do not replace GCal timezone AFTER trigger)
-- =============================================================================

CREATE OR REPLACE FUNCTION organization_settings_miniapp_currency_tz_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.currency_code IS DISTINCT FROM NEW.currency_code THEN
    IF EXISTS (
      SELECT 1
      FROM location_rental_hour_rates r
      WHERE r.organization_id = NEW.organization_id
    ) OR EXISTS (
      SELECT 1
      FROM rentals x
      WHERE x.organization_id = NEW.organization_id
        AND x.channel = 'miniapp'
    ) THEN
      RAISE EXCEPTION 'currency_code cannot change while Mini App rates or slots exist'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.timezone IS DISTINCT FROM NEW.timezone THEN
    IF EXISTS (
      SELECT 1
      FROM rentals x
      WHERE x.organization_id = NEW.organization_id
        AND x.channel = 'miniapp'
        AND x.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
    ) THEN
      RAISE EXCEPTION 'timezone cannot change while Mini App slots are awaiting_payment/active/prepaid_charged'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_settings_miniapp_currency_tz_guard_trg ON organization_settings;

CREATE TRIGGER organization_settings_miniapp_currency_tz_guard_trg
  BEFORE UPDATE OF currency_code, timezone ON organization_settings
  FOR EACH ROW
  EXECUTE FUNCTION organization_settings_miniapp_currency_tz_guard();

-- =============================================================================
-- 8. custom_access_token_hook: actor=renter does not read uao / does not set org claims
-- =============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims jsonb;
  v_user_id uuid;
  v_org_id uuid;
  v_member_id uuid;
  v_role text;
BEGIN
  claims := event -> 'claims';
  v_user_id := (claims ->> 'sub')::uuid;

  IF COALESCE(claims -> 'app_metadata' ->> 'actor', '') = 'renter' THEN
    claims := claims - 'organization_id' - 'member_id' - 'member_role';
    RETURN jsonb_build_object('claims', claims);
  END IF;

  SELECT uao.organization_id, uao.member_id, om.role
  INTO v_org_id, v_member_id, v_role
  FROM user_active_organizations uao
  JOIN organization_members om ON om.id = uao.member_id
  WHERE uao.user_id = v_user_id
    AND om.is_active = true;

  IF v_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{organization_id}', to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{member_id}', to_jsonb(v_member_id::text));
    claims := jsonb_set(claims, '{member_role}', to_jsonb(v_role));
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- =============================================================================
-- 9. organization_members INSERT: reject actor=renter on NEW.user_id (not caller JWT)
-- =============================================================================

CREATE OR REPLACE FUNCTION organization_members_reject_renter_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_actor text;
BEGIN
  SELECT u.raw_app_meta_data ->> 'actor'
  INTO v_actor
  FROM auth.users u
  WHERE u.id = NEW.user_id;

  IF v_actor = 'renter' THEN
    RAISE EXCEPTION 'renter cannot join organization_members'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_members_reject_renter_actor_trg ON organization_members;

CREATE TRIGGER organization_members_reject_renter_actor_trg
  BEFORE INSERT ON organization_members
  FOR EACH ROW
  EXECUTE FUNCTION organization_members_reject_renter_actor();

COMMIT;
