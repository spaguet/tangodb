-- FC2 / 2.9.50: reliability reset requires reason + audit row (P2-26).

BEGIN;

CREATE TABLE IF NOT EXISTS renter_reliability_reset_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id       uuid NOT NULL,
  actor_user_id   uuid NOT NULL REFERENCES auth.users (id),
  reason          text NOT NULL CHECK (char_length(trim(reason)) >= 3),
  on_time_before  integer NOT NULL DEFAULT 0,
  untimely_before integer NOT NULL DEFAULT 0,
  booking_banned_before timestamptz,
  penalty_tariff_before timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, renter_id) REFERENCES renters (organization_id, id)
);

CREATE INDEX IF NOT EXISTS idx_renter_reliability_reset_audit_renter
  ON renter_reliability_reset_audit (organization_id, renter_id, created_at DESC);

COMMENT ON TABLE renter_reliability_reset_audit IS
  'FC2: staff-initiated reliability counter/ban reset with mandatory reason.';

ALTER TABLE renter_reliability_reset_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE renter_reliability_reset_audit FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE renter_reliability_reset_audit TO service_role;

CREATE OR REPLACE FUNCTION reset_renter_reliability(p_renter_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_r renters%ROWTYPE;
  v_reason text := trim(coalesce(p_reason, ''));
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT can_manage_settings() OR NOT organization_allows_writes(v_org) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  IF char_length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.reliabilityResetReasonRequired');
  END IF;

  SELECT * INTO v_r
  FROM renters
  WHERE id = p_renter_id
    AND organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  INSERT INTO renter_reliability_reset_audit (
    organization_id,
    renter_id,
    actor_user_id,
    reason,
    on_time_before,
    untimely_before,
    booking_banned_before,
    penalty_tariff_before
  )
  VALUES (
    v_org,
    p_renter_id,
    auth.uid(),
    v_reason,
    coalesce(v_r.on_time_count, 0),
    coalesce(v_r.untimely_count, 0),
    v_r.booking_banned_at,
    v_r.penalty_tariff_applied_at
  );

  PERFORM _renter_acquire_miniapp_locks(v_org, p_renter_id, '[]'::jsonb);

  UPDATE renters
  SET
    booking_banned_at = NULL,
    penalty_tariff_applied_at = NULL,
    on_time_count = 0,
    untimely_count = 0,
    updated_at = now()
  WHERE id = p_renter_id
    AND organization_id = v_org;

  PERFORM _renter_enqueue_ban_lifted(v_org, p_renter_id);

  RETURN jsonb_build_object('success', true, 'renter_id', p_renter_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMENT ON FUNCTION reset_renter_reliability(uuid, text) IS
  'FC2: owner/director reset with mandatory reason; writes renter_reliability_reset_audit.';

COMMIT;
