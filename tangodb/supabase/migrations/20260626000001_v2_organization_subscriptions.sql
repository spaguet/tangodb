-- TangoDB v2 Phase 7 (S-1, S-3): SaaS subscriptions + grandfathering for lifetime licenses

-- =============================================================================
-- 1. organization_subscriptions
-- =============================================================================

CREATE TABLE organization_subscriptions (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL UNIQUE REFERENCES organizations (id) ON DELETE CASCADE,
  plan                      TEXT NOT NULL,
  billing_period            TEXT NOT NULL CHECK (billing_period IN ('monthly', 'yearly')),
  status                    TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled')),
  provider                  TEXT NOT NULL DEFAULT 'stripe',
  provider_customer_id      TEXT,
  provider_subscription_id  TEXT UNIQUE,
  current_period_start      TIMESTAMPTZ,
  current_period_end        TIMESTAMPTZ,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_org_subscriptions_status ON organization_subscriptions (status);
CREATE INDEX idx_org_subscriptions_period_end ON organization_subscriptions (current_period_end)
  WHERE status IN ('active', 'past_due');

-- Idempotent webhook processing
CREATE TABLE billing_webhook_events (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     TEXT NOT NULL DEFAULT 'stripe',
  event_id     TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

-- =============================================================================
-- 2. License / subscription helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION organization_has_lifetime_license(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_licenses ol
    WHERE ol.organization_id = p_org_id
      AND ol.license_type = 'lifetime'
  );
$$;

CREATE OR REPLACE FUNCTION organization_has_active_subscription(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organization_subscriptions os
    WHERE os.organization_id = p_org_id
      AND os.status = 'active'
      AND (os.current_period_end IS NULL OR os.current_period_end > now())
  );
$$;

CREATE OR REPLACE FUNCTION organization_allows_reads(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_org_id
      AND o.status IN ('demo_active', 'demo_retention', 'licensed')
  );
$$;

CREATE OR REPLACE FUNCTION organization_allows_writes(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM organizations o
    WHERE o.id = p_org_id
      AND NOT o.schema_version_locked
      AND (
        o.status = 'demo_active'
        OR (
          o.status = 'licensed'
          AND (
            organization_has_lifetime_license(o.id)
            OR organization_has_active_subscription(o.id)
          )
        )
      )
  );
$$;

-- =============================================================================
-- 3. sync_organization_subscription — webhook / service role entry point
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_organization_subscription(
  p_organization_id uuid,
  p_plan text,
  p_billing_period text,
  p_status text,
  p_provider text,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_event_id text DEFAULT NULL,
  p_event_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_version_id uuid;
  v_has_lifetime boolean;
  v_result jsonb;
BEGIN
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'organization_id required' USING ERRCODE = '22023';
  END IF;

  IF p_billing_period IS NOT NULL
     AND p_billing_period NOT IN ('monthly', 'yearly') THEN
    RAISE EXCEPTION 'invalid billing_period' USING ERRCODE = '22023';
  END IF;

  IF p_status IS NOT NULL
     AND p_status NOT IN ('active', 'past_due', 'canceled') THEN
    RAISE EXCEPTION 'invalid subscription status' USING ERRCODE = '22023';
  END IF;

  IF p_event_id IS NOT NULL AND length(trim(p_event_id)) > 0 THEN
    IF EXISTS (
      SELECT 1 FROM billing_webhook_events
      WHERE provider = COALESCE(NULLIF(trim(p_provider), ''), 'stripe')
        AND event_id = p_event_id
    ) THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true);
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_organization_id) THEN
    RAISE EXCEPTION 'organization not found' USING ERRCODE = '22023';
  END IF;

  v_has_lifetime := organization_has_lifetime_license(p_organization_id);

  INSERT INTO organization_subscriptions (
    organization_id,
    plan,
    billing_period,
    status,
    provider,
    provider_customer_id,
    provider_subscription_id,
    current_period_start,
    current_period_end,
    updated_at
  )
  VALUES (
    p_organization_id,
    COALESCE(NULLIF(trim(p_plan), ''), 'standard'),
    COALESCE(p_billing_period, 'monthly'),
    COALESCE(p_status, 'active'),
    COALESCE(NULLIF(trim(p_provider), ''), 'stripe'),
    NULLIF(trim(p_provider_customer_id), ''),
    NULLIF(trim(p_provider_subscription_id), ''),
    p_current_period_start,
    p_current_period_end,
    now()
  )
  ON CONFLICT (organization_id) DO UPDATE
    SET plan = EXCLUDED.plan,
        billing_period = EXCLUDED.billing_period,
        status = EXCLUDED.status,
        provider = EXCLUDED.provider,
        provider_customer_id = COALESCE(EXCLUDED.provider_customer_id, organization_subscriptions.provider_customer_id),
        provider_subscription_id = COALESCE(EXCLUDED.provider_subscription_id, organization_subscriptions.provider_subscription_id),
        current_period_start = EXCLUDED.current_period_start,
        current_period_end = EXCLUDED.current_period_end,
        updated_at = now();

  IF NOT v_has_lifetime THEN
    v_version_id := current_crm_version_id();

    INSERT INTO organization_licenses (
      organization_id,
      crm_version_id,
      license_type,
      activated_at,
      expires_at
    )
    VALUES (
      p_organization_id,
      v_version_id,
      'subscription',
      now(),
      CASE WHEN p_status = 'active' THEN NULL ELSE p_current_period_end END
    )
    ON CONFLICT (organization_id) DO UPDATE
      SET license_type = CASE
            WHEN organization_licenses.license_type = 'lifetime' THEN 'lifetime'
            ELSE 'subscription'
          END,
          expires_at = CASE
            WHEN organization_licenses.license_type = 'lifetime' THEN NULL
            WHEN p_status = 'active' THEN NULL
            ELSE p_current_period_end
          END;

    IF p_status = 'active' THEN
      UPDATE organizations
      SET status = 'licensed',
          data_purge_at = NULL,
          demo_expires_at = NULL
      WHERE id = p_organization_id
        AND status IN ('demo_active', 'demo_retention', 'suspended', 'licensed');
    ELSIF p_status = 'canceled' THEN
      UPDATE organizations
      SET status = 'suspended'
      WHERE id = p_organization_id
        AND status = 'licensed';
    END IF;
  END IF;

  IF p_event_id IS NOT NULL AND length(trim(p_event_id)) > 0 THEN
    INSERT INTO billing_webhook_events (provider, event_id, event_type)
    VALUES (
      COALESCE(NULLIF(trim(p_provider), ''), 'stripe'),
      p_event_id,
      COALESCE(NULLIF(trim(p_event_type), ''), 'unknown')
    )
    ON CONFLICT (provider, event_id) DO NOTHING;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'status', p_status,
    'grandfathered_lifetime', v_has_lifetime
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION sync_organization_subscription(
  uuid, text, text, text, text, text, text, timestamptz, timestamptz, text, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_organization_subscription(
  uuid, text, text, text, text, text, text, timestamptz, timestamptz, text, text
) TO service_role;

-- =============================================================================
-- 4. RLS
-- =============================================================================

ALTER TABLE organization_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_subscriptions_select_member
  ON organization_subscriptions FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND organization_allows_reads(organization_id)
  );

CREATE POLICY billing_webhook_events_service_only
  ON billing_webhook_events FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

GRANT SELECT ON organization_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON organization_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON billing_webhook_events TO service_role;

GRANT EXECUTE ON FUNCTION organization_has_lifetime_license(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION organization_has_active_subscription(uuid) TO authenticated, service_role;
