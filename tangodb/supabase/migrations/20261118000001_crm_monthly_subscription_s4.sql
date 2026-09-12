-- S4 / 2.11.7: expire CRM monthly subscriptions (past_due → suspend), digest SQL-source.
-- Writes already close at period_end via organization_has_active_subscription (S2a).
-- This tick only syncs status. Digest enqueue is S5b — no email/Telegram here.

BEGIN;

CREATE INDEX IF NOT EXISTS idx_organization_subscriptions_crm_expire
  ON organization_subscriptions (status, current_period_end)
  WHERE status IN ('active', 'past_due') AND current_period_end IS NOT NULL;

CREATE OR REPLACE FUNCTION expire_crm_organization_subscriptions(
  p_batch_size int DEFAULT 200,
  p_as_of timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_as_of timestamptz := COALESCE(p_as_of, now());
  v_grace constant interval := interval '7 days';
  v_past_due int := 0;
  v_suspended int := 0;
  rec record;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 OR p_batch_size > 5000 THEN
    RAISE EXCEPTION 'invalid batch size' USING ERRCODE = '22023';
  END IF;

  -- active AND now >= period_end → past_due (writes already closed in SQL)
  FOR rec IN
    SELECT os.organization_id
    FROM organization_subscriptions os
    WHERE os.status = 'active'
      AND os.current_period_end IS NOT NULL
      AND os.current_period_end <= v_as_of
      AND NOT organization_has_lifetime_license(os.organization_id)
    ORDER BY os.current_period_end
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE organization_subscriptions
    SET status = 'past_due',
        updated_at = now()
    WHERE organization_id = rec.organization_id
      AND status = 'active';
    v_past_due := v_past_due + 1;
  END LOOP;

  -- past_due AND now >= grace_end → canceled + organizations.status = suspended
  FOR rec IN
    SELECT os.organization_id
    FROM organization_subscriptions os
    JOIN organizations o ON o.id = os.organization_id
    WHERE os.status = 'past_due'
      AND os.current_period_end IS NOT NULL
      AND (os.current_period_end + v_grace) <= v_as_of
      AND NOT organization_has_lifetime_license(os.organization_id)
    ORDER BY os.current_period_end
    LIMIT p_batch_size
    FOR UPDATE OF os, o SKIP LOCKED
  LOOP
    UPDATE organization_subscriptions
    SET status = 'canceled',
        updated_at = now()
    WHERE organization_id = rec.organization_id
      AND status = 'past_due';

    UPDATE organizations
    SET status = 'suspended'
    WHERE id = rec.organization_id
      AND status = 'licensed';

    v_suspended := v_suspended + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'past_due_count', v_past_due,
    'suspended_count', v_suspended
  );
END;
$$;

REVOKE ALL ON FUNCTION expire_crm_organization_subscriptions(int, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION expire_crm_organization_subscriptions(int, timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION expire_crm_organization_subscriptions(int, timestamptz) TO service_role;

COMMENT ON FUNCTION expire_crm_organization_subscriptions(int, timestamptz) IS
  'S4: batch CRM SaaS expiry. active+period_end<=as_of → past_due; past_due+grace 7d → canceled+suspended. Idempotent SKIP LOCKED. Lifetime skipped. No notify.';

-- Digest source only. Enqueue to outbox is S5b.
CREATE OR REPLACE FUNCTION list_platform_crm_subscription_digest(
  p_as_of timestamptz DEFAULT now()
)
RETURNS TABLE (
  digest_type text,
  organization_id uuid,
  organization_name text,
  organization_status text,
  subscription_status text,
  provider text,
  current_period_end timestamptz,
  grace_end timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  WITH as_of AS (
    SELECT COALESCE(p_as_of, now()) AS ts
  )
  SELECT
    'expiring'::text,
    o.id,
    o.name,
    o.status::text,
    os.status::text,
    os.provider,
    os.current_period_end,
    os.current_period_end + interval '7 days'
  FROM organization_subscriptions os
  JOIN organizations o ON o.id = os.organization_id
  CROSS JOIN as_of
  WHERE os.status = 'active'
    AND os.current_period_end IS NOT NULL
    AND os.current_period_end > as_of.ts
    AND os.current_period_end <= as_of.ts + interval '7 days'
    AND o.status = 'licensed'
    AND NOT organization_has_lifetime_license(o.id)

  UNION ALL

  SELECT
    'overdue'::text,
    o.id,
    o.name,
    o.status::text,
    os.status::text,
    os.provider,
    os.current_period_end,
    os.current_period_end + interval '7 days'
  FROM organization_subscriptions os
  JOIN organizations o ON o.id = os.organization_id
  CROSS JOIN as_of
  WHERE os.status IN ('active', 'past_due')
    AND os.current_period_end IS NOT NULL
    AND os.current_period_end <= as_of.ts
    AND o.status = 'licensed'
    AND NOT organization_has_lifetime_license(o.id);
$$;

REVOKE ALL ON FUNCTION list_platform_crm_subscription_digest(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_platform_crm_subscription_digest(timestamptz) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION list_platform_crm_subscription_digest(timestamptz) TO service_role;

COMMENT ON FUNCTION list_platform_crm_subscription_digest(timestamptz) IS
  'S4 SQL-source for developer digest: expiring (T−7) and overdue (period_end reached, still licensed). No send. Enqueue S5b.';

COMMENT ON FUNCTION organization_has_active_subscription(uuid) IS
  'Paid CRM month is active only while status=active AND period_end > now() (manual requires non-null end). Mini App follows this gate and turns off at period_end without waiting for expire cron.';

COMMIT;
