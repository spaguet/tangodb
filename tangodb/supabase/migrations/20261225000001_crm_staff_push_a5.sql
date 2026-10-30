-- A5: CRM staff Android push (FCM outbox + device tokens) and enqueue on cancel / move / substitute.

BEGIN;

-- =============================================================================
-- 1. Device tokens (member-scoped, same org RLS)
-- =============================================================================

CREATE TABLE crm_staff_push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  member_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  install_id TEXT NOT NULL CHECK (char_length(trim(install_id)) > 0),
  fcm_token TEXT NOT NULL CHECK (char_length(trim(fcm_token)) > 0),
  platform TEXT NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios')),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, member_id, install_id),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX crm_staff_push_devices_active
  ON crm_staff_push_devices (organization_id, member_id)
  WHERE revoked_at IS NULL;

ALTER TABLE crm_staff_push_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_staff_push_devices_select_own ON crm_staff_push_devices
  FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND member_id = auth_member_id()
    AND user_id = auth.uid()
  );

REVOKE ALL ON crm_staff_push_devices FROM PUBLIC, anon;
GRANT SELECT ON crm_staff_push_devices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_staff_push_devices TO service_role;

-- =============================================================================
-- 2. Outbox (worker drains with service_role)
-- =============================================================================

CREATE TABLE crm_staff_push_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  target_member_id UUID NOT NULL,
  event_kind TEXT NOT NULL CHECK (
    event_kind IN ('lesson_cancelled', 'lesson_rescheduled', 'lesson_substitute')
  ),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts >= 1),
  claim_token TEXT,
  claim_until TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, target_member_id)
    REFERENCES organization_members (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX crm_staff_push_outbox_pending
  ON crm_staff_push_outbox (created_at)
  WHERE sent_at IS NULL;

ALTER TABLE crm_staff_push_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY crm_staff_push_outbox_deny_authenticated ON crm_staff_push_outbox
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON crm_staff_push_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_staff_push_outbox TO service_role;

-- =============================================================================
-- 3. Enqueue helper (no push for accountants)
-- =============================================================================

CREATE OR REPLACE FUNCTION enqueue_crm_staff_push(
  p_org_id UUID,
  p_target_member_id UUID,
  p_event_kind TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF p_org_id IS NULL OR p_target_member_id IS NULL OR p_event_kind IS NULL THEN
    RETURN;
  END IF;

  SELECT om.role
  INTO v_role
  FROM organization_members om
  WHERE om.organization_id = p_org_id
    AND om.id = p_target_member_id;

  IF NOT FOUND OR v_role = 'accountant' THEN
    RETURN;
  END IF;

  INSERT INTO crm_staff_push_outbox (organization_id, target_member_id, event_kind, payload)
  VALUES (p_org_id, p_target_member_id, p_event_kind, COALESCE(p_payload, '{}'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION enqueue_crm_staff_push(UUID, UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_crm_staff_push(UUID, UUID, TEXT, JSONB) TO service_role;

-- =============================================================================
-- 4. Client RPC: register / revoke device token
-- =============================================================================

CREATE OR REPLACE FUNCTION register_crm_staff_push_device(
  p_install_id TEXT,
  p_fcm_token TEXT,
  p_platform TEXT DEFAULT 'android'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id UUID := auth_organization_id();
  v_member_id UUID := auth_member_id();
  v_user_id UUID := auth.uid();
  v_install TEXT := NULLIF(trim(p_install_id), '');
  v_token TEXT := NULLIF(trim(p_fcm_token), '');
  v_platform TEXT := COALESCE(NULLIF(trim(p_platform), ''), 'android');
  v_role TEXT := current_member_role();
BEGIN
  IF v_user_id IS NULL OR v_org_id IS NULL OR v_member_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth.error.unauthorized');
  END IF;

  IF v_role = 'accountant' THEN
    RETURN jsonb_build_object('success', true, 'skipped', true);
  END IF;

  IF v_install IS NULL OR v_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'push.error.invalidDevice');
  END IF;

  IF v_platform NOT IN ('android', 'ios') THEN
    v_platform := 'android';
  END IF;

  INSERT INTO crm_staff_push_devices (
    organization_id,
    member_id,
    user_id,
    install_id,
    fcm_token,
    platform,
    revoked_at,
    updated_at
  )
  VALUES (
    v_org_id,
    v_member_id,
    v_user_id,
    v_install,
    v_token,
    v_platform,
    NULL,
    now()
  )
  ON CONFLICT (organization_id, member_id, install_id)
  DO UPDATE SET
    fcm_token = EXCLUDED.fcm_token,
    platform = EXCLUDED.platform,
    user_id = EXCLUDED.user_id,
    revoked_at = NULL,
    updated_at = now();

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION revoke_crm_staff_push_device(p_install_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id UUID := auth_organization_id();
  v_member_id UUID := auth_member_id();
  v_install TEXT := NULLIF(trim(p_install_id), '');
BEGIN
  IF auth.uid() IS NULL OR v_install IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'auth.error.unauthorized');
  END IF;

  UPDATE crm_staff_push_devices d
  SET revoked_at = now(), updated_at = now()
  WHERE d.install_id = v_install
    AND d.revoked_at IS NULL
    AND (
      (v_org_id IS NOT NULL AND v_member_id IS NOT NULL
        AND d.organization_id = v_org_id AND d.member_id = v_member_id)
      OR d.user_id = auth.uid()
    );

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION register_crm_staff_push_device(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_crm_staff_push_device(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_crm_staff_push_device(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION revoke_crm_staff_push_device(TEXT) TO authenticated;

-- =============================================================================
-- 5. Worker claim / complete
-- =============================================================================

CREATE OR REPLACE FUNCTION claim_crm_staff_push_outbox(
  p_batch_size INTEGER DEFAULT 10,
  p_worker_id TEXT DEFAULT NULL,
  p_lease_seconds INTEGER DEFAULT 120
)
RETURNS SETOF crm_staff_push_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_batch_size, 10), 1), 50);
  v_token TEXT := COALESCE(NULLIF(trim(p_worker_id), ''), gen_random_uuid()::text);
  v_until TIMESTAMPTZ := now() + make_interval(secs => GREATEST(COALESCE(p_lease_seconds, 120), 30));
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM crm_staff_push_outbox o
    WHERE o.sent_at IS NULL
      AND o.attempts < o.max_attempts
      AND (o.claim_until IS NULL OR o.claim_until < now())
    ORDER BY o.created_at
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE crm_staff_push_outbox o
  SET
    claim_token = v_token,
    claim_until = v_until,
    attempts = o.attempts + 1
  FROM picked
  WHERE o.id = picked.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION complete_crm_staff_push_outbox(
  p_id UUID,
  p_outcome TEXT,
  p_claim_token TEXT,
  p_error TEXT DEFAULT NULL,
  p_retry_seconds INTEGER DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_outcome = 'sent' THEN
    UPDATE crm_staff_push_outbox o
    SET sent_at = now(), claim_token = NULL, claim_until = NULL, last_error = NULL
    WHERE o.id = p_id
      AND o.claim_token IS NOT DISTINCT FROM p_claim_token;
    RETURN;
  END IF;

  IF p_outcome = 'dead' THEN
    UPDATE crm_staff_push_outbox o
    SET sent_at = now(), claim_token = NULL, claim_until = NULL, last_error = LEFT(COALESCE(p_error, 'dead'), 500)
    WHERE o.id = p_id
      AND o.claim_token IS NOT DISTINCT FROM p_claim_token;
    RETURN;
  END IF;

  UPDATE crm_staff_push_outbox o
  SET
    claim_token = NULL,
    claim_until = CASE
      WHEN p_retry_seconds IS NOT NULL AND p_retry_seconds > 0
        THEN now() + make_interval(secs => p_retry_seconds)
      ELSE NULL
    END,
    last_error = LEFT(COALESCE(p_error, 'retry'), 500)
  WHERE o.id = p_id
    AND o.claim_token IS NOT DISTINCT FROM p_claim_token;
END;
$$;

REVOKE ALL ON FUNCTION claim_crm_staff_push_outbox(INTEGER, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_crm_staff_push_outbox(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_crm_staff_push_outbox(INTEGER, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION complete_crm_staff_push_outbox(UUID, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- =============================================================================
-- 6. Triggers: cancel / reschedule / substitute
-- =============================================================================

CREATE OR REPLACE FUNCTION crm_staff_push_on_schedule_cancellation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := COALESCE(NULLIF(trim(NEW.group_name), ''), 'lesson');
  v_body TEXT;
BEGIN
  IF NEW.teacher_member_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_body := to_char(NEW.occurrence_date, 'DD.MM') || ' · ' || NEW.time || ' · ' || v_label;

  PERFORM enqueue_crm_staff_push(
    NEW.organization_id,
    NEW.teacher_member_id,
    'lesson_cancelled',
    jsonb_build_object(
      'occurrence_date', NEW.occurrence_date::text,
      'time', NEW.time,
      'label', v_label,
      'body', v_body
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_staff_push_schedule_cancellation ON schedule_occurrence_cancellations;
CREATE TRIGGER crm_staff_push_schedule_cancellation
  AFTER INSERT ON schedule_occurrence_cancellations
  FOR EACH ROW
  EXECUTE FUNCTION crm_staff_push_on_schedule_cancellation();

CREATE OR REPLACE FUNCTION crm_staff_push_on_lesson_move()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := COALESCE(NULLIF(trim(NEW.group_name), ''), 'lesson');
  v_body TEXT;
BEGIN
  IF NEW.moved_from_slot_id IS NULL OR NEW.moved_from_date IS NULL OR NEW.teacher_member_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_body := to_char(NEW.moved_from_date, 'DD.MM') || ' → ' || to_char(NEW.valid_from, 'DD.MM')
    || ' · ' || NEW.time || ' · ' || v_label;

  PERFORM enqueue_crm_staff_push(
    NEW.organization_id,
    NEW.teacher_member_id,
    'lesson_rescheduled',
    jsonb_build_object(
      'from_date', NEW.moved_from_date::text,
      'time', NEW.time,
      'label', v_label,
      'body', v_body
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_staff_push_lesson_move ON schedule_slots;
CREATE TRIGGER crm_staff_push_lesson_move
  AFTER INSERT ON schedule_slots
  FOR EACH ROW
  EXECUTE FUNCTION crm_staff_push_on_lesson_move();

CREATE OR REPLACE FUNCTION crm_staff_push_on_substitute()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := 'lesson';
  v_time TEXT;
  v_body TEXT;
BEGIN
  IF NEW.occurrence_kind = 'group' AND NEW.schedule_slot_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(trim(ss.group_name), ''), 'lesson'), ss.time
    INTO v_label, v_time
    FROM schedule_slots ss
    WHERE ss.id = NEW.schedule_slot_id
      AND ss.organization_id = NEW.organization_id;
  ELSIF NEW.occurrence_kind = 'personal' AND NEW.personal_lesson_id IS NOT NULL THEN
    SELECT COALESCE(NULLIF(trim(d.name), ''), 'personal'), pl.time_start
    INTO v_label, v_time
    FROM personal_lessons pl
    LEFT JOIN disciplines d ON d.id = pl.discipline_id
    WHERE pl.id = NEW.personal_lesson_id
      AND pl.organization_id = NEW.organization_id;
  END IF;

  v_time := COALESCE(v_time, '00:00');
  v_body := to_char(NEW.occurrence_date, 'DD.MM') || ' · ' || v_time || ' · ' || v_label;

  PERFORM enqueue_crm_staff_push(
    NEW.organization_id,
    NEW.substitute_teacher_member_id,
    'lesson_substitute',
    jsonb_build_object(
      'occurrence_date', NEW.occurrence_date::text,
      'time', v_time,
      'label', v_label,
      'body', v_body
    )
  );

  PERFORM enqueue_crm_staff_push(
    NEW.organization_id,
    NEW.original_teacher_member_id,
    'lesson_substitute',
    jsonb_build_object(
      'occurrence_date', NEW.occurrence_date::text,
      'time', v_time,
      'label', v_label,
      'body', v_body
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_staff_push_substitute ON lesson_occurrence_substitutes;
CREATE TRIGGER crm_staff_push_substitute
  AFTER INSERT ON lesson_occurrence_substitutes
  FOR EACH ROW
  EXECUTE FUNCTION crm_staff_push_on_substitute();

COMMIT;
