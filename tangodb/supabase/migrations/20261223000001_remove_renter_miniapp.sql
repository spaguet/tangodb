-- Remove the Telegram Mini App rental node.
-- Cashier hall rental (channel = cashier) stays.
-- Historical migrations stay; this forward migration stops the worker, cron,
-- bot secrets, and future Mini App occupancy.

BEGIN;

-- pg_cron job that POSTed renter-booking-worker every 2 minutes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(jobid)
    FROM cron.job
    WHERE jobname = 'renter-booking-worker';
  END IF;
END $$;

-- Free halls held by unfinished Mini App bookings. Past settled/debt rows stay as history.
UPDATE rentals
SET
  booking_status = 'cancelled',
  lifecycle = CASE
    WHEN lifecycle = 'awaiting_payment' THEN 'hold_deleted'
    ELSE 'cancelled'
  END,
  cancelled_at = COALESCE(cancelled_at, now()),
  cancelled_reason = COALESCE(cancelled_reason, 'miniapp_removed'),
  updated_at = now()
WHERE channel = 'miniapp'
  AND booking_status = 'confirmed'
  AND lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged');

UPDATE rental_series
SET
  status = 'cancelled',
  updated_at = now()
WHERE channel = 'miniapp'
  AND status = 'active';

UPDATE locations
SET miniapp_enabled = false
WHERE miniapp_enabled IS TRUE;

-- Drop studio bot credentials so a removed webhook cannot keep a token.
UPDATE organization_renter_channel
SET
  encrypted_bot_token = NULL,
  webhook_secret = NULL,
  webhook_token = NULL,
  telegram_bot_id = NULL,
  bot_username = NULL,
  bot_token_last4 = NULL,
  app_short_name = NULL,
  updated_at = now();

DROP TRIGGER IF EXISTS organization_settings_miniapp_currency_tz_guard_trg ON organization_settings;

CREATE OR REPLACE FUNCTION organization_settings_miniapp_currency_tz_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN NEW;
END;
$$;

-- Cashier create must not promote a slot onto the Mini App wallet.
CREATE OR REPLACE FUNCTION _renter_attach_wallet_to_staff_cashier_rentals(p_rental_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION _renter_attach_wallet_to_staff_cashier_rental(p_rental_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION renter_booking_maintenance_due_pairs()
RETURNS TABLE (organization_id uuid, renter_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULL::uuid, NULL::uuid WHERE false;
$$;

CREATE OR REPLACE FUNCTION claim_renter_booking_maintenance(p_batch_size integer DEFAULT 20)
RETURNS TABLE (organization_id uuid, renter_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULL::uuid, NULL::uuid WHERE false;
$$;

CREATE OR REPLACE FUNCTION run_renter_booking_maintenance(p_batch_size integer DEFAULT 20)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'ok', true,
    'processed', 0,
    'failed', 0,
    'failures', '[]'::jsonb,
    'progressed', false,
    'skipped', 'miniapp_removed'
  );
$$;

REVOKE ALL ON FUNCTION renter_booking_maintenance_due_pairs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION claim_renter_booking_maintenance(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION run_renter_booking_maintenance(integer) FROM PUBLIC, anon, authenticated;

-- PostgREST must not keep calling Mini App / wallet RPCs after the app is gone.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname LIKE 'renter\_%' ESCAPE '\'
        OR p.proname LIKE '\_renter\_%' ESCAPE '\'
        OR p.proname LIKE '%miniapp%'
        OR p.proname LIKE 'staff\_renter\_wallet%' ESCAPE '\'
        OR p.proname LIKE '%renter\_topup%' ESCAPE '\'
        OR p.proname LIKE '%renter\_wallet%' ESCAPE '\'
        OR p.proname = 'reset_renter_reliability'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

DROP INDEX IF EXISTS idx_rentals_miniapp_lifecycle_date;
DROP INDEX IF EXISTS idx_rentals_miniapp_awaiting_hold;

COMMIT;
