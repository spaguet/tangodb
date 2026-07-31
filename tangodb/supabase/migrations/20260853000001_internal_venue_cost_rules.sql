-- Internal venue cost policies, occurrence closing, accrual ledger and payment expiry acknowledgement.
-- External hall rentals are intentionally out of scope.

BEGIN;

-- =============================================================================
-- 1. Versioned rules and append-oriented ledger
-- =============================================================================

CREATE TABLE venue_cost_rule_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  version_number      BIGINT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'accepted')),
  mode                TEXT NOT NULL
    CHECK (mode IN ('per_lesson', 'fixed_period', 'disabled')),
  valid_from          DATE NOT NULL,
  valid_to            DATE,
  rules               JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by          UUID,
  accepted_by         UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at         TIMESTAMPTZ,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, version_number),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  FOREIGN KEY (organization_id, accepted_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (mode <> 'fixed_period' OR valid_to IS NOT NULL),
  CHECK (
    (status = 'draft' AND accepted_at IS NULL AND accepted_by IS NULL)
    OR
    (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL)
  )
);

CREATE INDEX idx_venue_cost_rules_org_status_dates
  ON venue_cost_rule_versions (organization_id, status, valid_from, valid_to);

CREATE INDEX idx_venue_cost_rules_org_accepted
  ON venue_cost_rule_versions (organization_id, accepted_at DESC)
  WHERE status = 'accepted';

CREATE TABLE lesson_occurrence_closures (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  occurrence_kind           TEXT NOT NULL CHECK (occurrence_kind IN ('group', 'personal')),
  occurrence_date           DATE NOT NULL,
  schedule_slot_id          UUID,
  personal_lesson_id        UUID,
  source_personal_lesson_id UUID,
  discipline_id             UUID,
  location_id               UUID,
  confirmed_attendee_count  INTEGER,
  status                    TEXT NOT NULL DEFAULT 'closed'
    CHECK (status IN ('closed', 'reopened')),
  pricing_status            TEXT NOT NULL DEFAULT 'pending_unpriced'
    CHECK (pricing_status IN ('priced', 'pending_unpriced', 'not_applicable', 'reversed')),
  rule_version_id           UUID,
  source_snapshot           JSONB NOT NULL DEFAULT '{}'::jsonb,
  closed_by                 UUID,
  closed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  reopened_by               UUID,
  reopened_at               TIMESTAMPTZ,
  reopen_reason             TEXT,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, schedule_slot_id)
    REFERENCES schedule_slots (organization_id, id),
  CONSTRAINT lesson_closure_personal_lesson_fk
    FOREIGN KEY (organization_id, personal_lesson_id)
    REFERENCES personal_lessons (organization_id, id)
    ON DELETE SET NULL (personal_lesson_id),
  FOREIGN KEY (organization_id, discipline_id)
    REFERENCES disciplines (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id),
  FOREIGN KEY (organization_id, rule_version_id)
    REFERENCES venue_cost_rule_versions (organization_id, id),
  FOREIGN KEY (organization_id, closed_by)
    REFERENCES organization_members (organization_id, id),
  FOREIGN KEY (organization_id, reopened_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (
    (occurrence_kind = 'group' AND schedule_slot_id IS NOT NULL
      AND personal_lesson_id IS NULL AND source_personal_lesson_id IS NULL
      AND confirmed_attendee_count IS NOT NULL AND confirmed_attendee_count >= 0)
    OR
    (occurrence_kind = 'personal' AND source_personal_lesson_id IS NOT NULL AND schedule_slot_id IS NULL
      AND (personal_lesson_id IS NULL OR personal_lesson_id = source_personal_lesson_id)
      AND confirmed_attendee_count IS NULL)
  ),
  CHECK (
    (status = 'closed' AND reopened_at IS NULL AND reopened_by IS NULL AND reopen_reason IS NULL)
    OR
    (status = 'reopened' AND reopened_at IS NOT NULL AND reopened_by IS NOT NULL
      AND length(trim(reopen_reason)) > 0)
  )
);

CREATE UNIQUE INDEX lesson_closure_active_group_unique
  ON lesson_occurrence_closures (organization_id, schedule_slot_id, occurrence_date)
  WHERE occurrence_kind = 'group' AND status = 'closed';

CREATE UNIQUE INDEX lesson_closure_active_personal_unique
  ON lesson_occurrence_closures (organization_id, source_personal_lesson_id)
  WHERE occurrence_kind = 'personal' AND status = 'closed';

CREATE INDEX idx_lesson_closures_org_date
  ON lesson_occurrence_closures (organization_id, occurrence_date DESC);

CREATE INDEX idx_lesson_closures_pending
  ON lesson_occurrence_closures (organization_id, occurrence_date)
  WHERE status = 'closed' AND pricing_status = 'pending_unpriced';

CREATE TABLE venue_cost_accruals (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  rule_version_id       UUID,
  closure_id            UUID,
  accrual_kind          TEXT NOT NULL
    CHECK (accrual_kind IN ('lesson', 'fixed_period', 'adjustment')),
  accrual_status        TEXT NOT NULL
    CHECK (accrual_status IN ('pending_unpriced', 'posted', 'void')),
  accrual_date          DATE NOT NULL,
  period_from           DATE,
  period_to             DATE,
  amount                NUMERIC(14, 2),
  currency              TEXT NOT NULL DEFAULT 'RUB',
  adjusts_accrual_id    UUID,
  rule_snapshot         JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot       JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason                TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, rule_version_id)
    REFERENCES venue_cost_rule_versions (organization_id, id),
  FOREIGN KEY (organization_id, closure_id)
    REFERENCES lesson_occurrence_closures (organization_id, id),
  FOREIGN KEY (organization_id, adjusts_accrual_id)
    REFERENCES venue_cost_accruals (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (
    (accrual_status = 'pending_unpriced' AND amount IS NULL AND rule_version_id IS NULL)
    OR
    (accrual_status IN ('posted', 'void') AND amount IS NOT NULL)
  ),
  CHECK (period_to IS NULL OR (period_from IS NOT NULL AND period_to >= period_from)),
  CHECK (
    (accrual_kind = 'adjustment' AND adjusts_accrual_id IS NOT NULL AND reason IS NOT NULL)
    OR
    (accrual_kind <> 'adjustment' AND adjusts_accrual_id IS NULL)
  )
);

CREATE UNIQUE INDEX venue_cost_pending_closure_unique
  ON venue_cost_accruals (organization_id, closure_id)
  WHERE closure_id IS NOT NULL AND accrual_status = 'pending_unpriced';

CREATE UNIQUE INDEX venue_cost_posted_lesson_unique
  ON venue_cost_accruals (organization_id, closure_id)
  WHERE closure_id IS NOT NULL AND accrual_kind = 'lesson' AND accrual_status = 'posted';

CREATE UNIQUE INDEX venue_cost_fixed_period_unique
  ON venue_cost_accruals (organization_id, rule_version_id, period_from, period_to)
  WHERE accrual_kind = 'fixed_period' AND accrual_status = 'posted';

CREATE INDEX idx_venue_cost_accruals_org_date
  ON venue_cost_accruals (organization_id, accrual_date DESC);

CREATE INDEX idx_venue_cost_accruals_adjusts
  ON venue_cost_accruals (organization_id, adjusts_accrual_id)
  WHERE adjusts_accrual_id IS NOT NULL;

CREATE TABLE venue_rule_payment_acknowledgements (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  payment_id            UUID NOT NULL,
  operation_scope       TEXT NOT NULL,
  idempotency_key       UUID,
  expired_rule_id       UUID NOT NULL,
  acknowledged_by       UUID NOT NULL,
  acknowledged_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status_snapshot       JSONB NOT NULL,
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, payment_id),
  FOREIGN KEY (organization_id, payment_id)
    REFERENCES payments (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, expired_rule_id)
    REFERENCES venue_cost_rule_versions (organization_id, id),
  FOREIGN KEY (organization_id, acknowledged_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX idx_venue_rule_payment_ack_org_created
  ON venue_rule_payment_acknowledgements (organization_id, acknowledged_at DESC);

-- =============================================================================
-- 2. Validation, immutability and pricing helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION venue_cost_rules_are_valid(p_mode text, p_rules jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_rule jsonb;
  v_tier jsonb;
  v_min integer;
  v_max integer;
  v_expected_min integer;
BEGIN
  IF p_mode = 'disabled' THEN
    RETURN p_rules IS NOT NULL AND jsonb_typeof(p_rules) = 'object';
  END IF;

  IF p_rules IS NULL OR jsonb_typeof(p_rules) <> 'object' THEN
    RETURN false;
  END IF;

  IF p_mode = 'fixed_period' THEN
    RETURN p_rules ->> 'period' IN ('week', 'month', 'custom')
      AND (p_rules ->> 'amount') IS NOT NULL
      AND (p_rules ->> 'amount')::numeric >= 0;
  END IF;

  IF p_mode <> 'per_lesson'
    OR jsonb_typeof(COALESCE(p_rules -> 'group', '[]'::jsonb)) <> 'array'
    OR jsonb_typeof(COALESCE(p_rules -> 'personal', '[]'::jsonb)) <> 'array'
  THEN
    RETURN false;
  END IF;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'group', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_rule) <> 'object'
      OR jsonb_typeof(COALESCE(v_rule -> 'attendance_tiers', 'null'::jsonb)) <> 'array'
      OR jsonb_array_length(v_rule -> 'attendance_tiers') = 0
    THEN
      RETURN false;
    END IF;
    IF v_rule ->> 'discipline_id' IS NOT NULL THEN
      PERFORM (v_rule ->> 'discipline_id')::uuid;
    END IF;
    IF v_rule ->> 'location_id' IS NOT NULL THEN
      PERFORM (v_rule ->> 'location_id')::uuid;
    END IF;
    v_expected_min := 0;
    FOR v_tier IN
      SELECT value
      FROM jsonb_array_elements(v_rule -> 'attendance_tiers')
      ORDER BY (value ->> 'min_attendees')::integer
    LOOP
      v_min := (v_tier ->> 'min_attendees')::integer;
      v_max := NULLIF(v_tier ->> 'max_attendees', '')::integer;
      IF v_min IS NULL OR v_expected_min IS NULL OR v_min <> v_expected_min
        OR v_min < 0 OR (v_max IS NOT NULL AND v_max < v_min)
        OR (v_tier ->> 'amount') IS NULL OR (v_tier ->> 'amount')::numeric < 0
      THEN
        RETURN false;
      END IF;
      v_expected_min := CASE WHEN v_max IS NULL THEN NULL ELSE v_max + 1 END;
    END LOOP;
    IF v_expected_min IS NOT NULL THEN RETURN false; END IF;
  END LOOP;

  FOR v_rule IN SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'personal', '[]'::jsonb))
  LOOP
    IF jsonb_typeof(v_rule) <> 'object'
      OR (v_rule ->> 'amount') IS NULL OR (v_rule ->> 'amount')::numeric < 0
    THEN
      RETURN false;
    END IF;
    IF v_rule ->> 'discipline_id' IS NOT NULL THEN
      PERFORM (v_rule ->> 'discipline_id')::uuid;
    END IF;
    IF v_rule ->> 'location_id' IS NOT NULL THEN
      PERFORM (v_rule ->> 'location_id')::uuid;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

ALTER TABLE venue_cost_rule_versions
  ADD CONSTRAINT venue_cost_rule_versions_rules_valid
  CHECK (venue_cost_rules_are_valid(mode, rules));

CREATE OR REPLACE FUNCTION venue_cost_rule_references_are_valid(
  p_org_id uuid,
  p_mode text,
  p_rules jsonb
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_discipline_id uuid;
  v_location_id uuid;
BEGIN
  IF p_mode <> 'per_lesson' THEN
    RETURN true;
  END IF;

  FOR v_item IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'group', '[]'::jsonb))
    UNION ALL
    SELECT value FROM jsonb_array_elements(COALESCE(p_rules -> 'personal', '[]'::jsonb))
  LOOP
    v_discipline_id := NULLIF(v_item ->> 'discipline_id', '')::uuid;
    v_location_id := NULLIF(v_item ->> 'location_id', '')::uuid;

    IF v_discipline_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM disciplines d
      WHERE d.organization_id = p_org_id AND d.id = v_discipline_id
    ) THEN
      RETURN false;
    END IF;

    IF v_location_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM locations l
      WHERE l.organization_id = p_org_id AND l.id = v_location_id
    ) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION venue_cost_rule_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'accepted' THEN
    RAISE EXCEPTION 'accepted_venue_rule_is_immutable' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'accepted' THEN
    RAISE EXCEPTION 'accepted_venue_rule_is_immutable' USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'accepted' THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(NEW.organization_id::text || ':venue-rules', 0)
    );
    IF EXISTS (
      SELECT 1
      FROM venue_cost_rule_versions r
      WHERE r.organization_id = NEW.organization_id
        AND r.status = 'accepted'
        AND r.id <> NEW.id
        AND daterange(r.valid_from, COALESCE(r.valid_to, 'infinity'::date), '[]')
            && daterange(NEW.valid_from, COALESCE(NEW.valid_to, 'infinity'::date), '[]')
    ) THEN
      RAISE EXCEPTION 'accepted_venue_rule_overlap' USING ERRCODE = '23P01';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER venue_cost_rule_guard_trigger
  BEFORE UPDATE OR DELETE ON venue_cost_rule_versions
  FOR EACH ROW EXECUTE FUNCTION venue_cost_rule_guard();

CREATE TRIGGER venue_cost_rule_accept_insert_guard_trigger
  BEFORE INSERT ON venue_cost_rule_versions
  FOR EACH ROW WHEN (NEW.status = 'accepted')
  EXECUTE FUNCTION venue_cost_rule_guard();

CREATE OR REPLACE FUNCTION venue_cost_status_for_org(p_org_id uuid, p_at date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_latest_non_disabled venue_cost_rule_versions%ROWTYPE;
  v_current venue_cost_rule_versions%ROWTYPE;
  v_ack boolean := false;
  v_pending_unpriced_count bigint := 0;
BEGIN
  SELECT * INTO v_current
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = p_org_id
    AND r.status = 'accepted'
    AND r.valid_from <= p_at
    AND (r.valid_to IS NULL OR r.valid_to >= p_at)
  ORDER BY r.accepted_at DESC, r.version_number DESC
  LIMIT 1;

  SELECT * INTO v_latest_non_disabled
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = p_org_id
    AND r.status = 'accepted'
    AND r.mode <> 'disabled'
    AND r.valid_from <= p_at
  ORDER BY r.valid_from DESC, r.accepted_at DESC, r.version_number DESC
  LIMIT 1;

  v_ack := v_current.id IS NULL
    AND v_latest_non_disabled.id IS NOT NULL
    AND v_latest_non_disabled.valid_to IS NOT NULL
    AND v_latest_non_disabled.valid_to < p_at;

  SELECT count(*) INTO v_pending_unpriced_count
  FROM lesson_occurrence_closures c
  WHERE c.organization_id = p_org_id
    AND c.status = 'closed'
    AND c.pricing_status = 'pending_unpriced';

  RETURN jsonb_build_object(
    'status', CASE
      WHEN v_current.id IS NOT NULL AND v_current.mode = 'disabled' THEN 'disabled'
      WHEN v_current.id IS NOT NULL THEN 'active'
      WHEN v_ack THEN 'expired_ack_required'
      WHEN v_latest_non_disabled.id IS NULL THEN 'not_configured'
      ELSE 'inactive'
    END,
    'acknowledgement_required', v_ack,
    'current_rule_id', v_current.id,
    'current_mode', v_current.mode,
    'latest_rule_id', v_latest_non_disabled.id,
    'latest_mode', v_latest_non_disabled.mode,
    'latest_valid_to', v_latest_non_disabled.valid_to,
    'pending_unpriced_count', v_pending_unpriced_count,
    'as_of', p_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION get_venue_cost_rule_status(p_at date DEFAULT current_date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'unauthorized');
  END IF;
  RETURN venue_cost_status_for_org(v_org_id, p_at) || jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION venue_cost_rule_at(p_org_id uuid, p_date date)
RETURNS venue_cost_rule_versions
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = p_org_id
    AND r.status = 'accepted'
    AND r.valid_from <= p_date
    AND (r.valid_to IS NULL OR r.valid_to >= p_date)
  ORDER BY r.accepted_at DESC, r.version_number DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION venue_cost_amount_for_lesson(
  p_rule venue_cost_rule_versions,
  p_kind text,
  p_discipline_id uuid,
  p_location_id uuid,
  p_attendee_count integer
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_item jsonb;
  v_tier jsonb;
BEGIN
  IF p_rule.id IS NULL OR p_rule.mode IN ('disabled', 'fixed_period') THEN
    RETURN 0;
  END IF;

  IF p_kind = 'personal' THEN
    SELECT value INTO v_item
    FROM jsonb_array_elements(COALESCE(p_rule.rules -> 'personal', '[]'::jsonb))
    WHERE ((value ->> 'discipline_id') IS NULL OR (value ->> 'discipline_id')::uuid = p_discipline_id)
      AND ((value ->> 'location_id') IS NULL OR (value ->> 'location_id')::uuid = p_location_id)
    ORDER BY
      (CASE WHEN value ->> 'discipline_id' IS NULL THEN 0 ELSE 1 END
       + CASE WHEN value ->> 'location_id' IS NULL THEN 0 ELSE 1 END) DESC,
      CASE WHEN value ->> 'discipline_id' IS NULL THEN 1 ELSE 0 END,
      CASE WHEN value ->> 'location_id' IS NULL THEN 1 ELSE 0 END
    LIMIT 1;
    RETURN COALESCE((v_item ->> 'amount')::numeric, 0);
  END IF;

  SELECT value INTO v_item
  FROM jsonb_array_elements(COALESCE(p_rule.rules -> 'group', '[]'::jsonb))
  WHERE ((value ->> 'discipline_id') IS NULL OR (value ->> 'discipline_id')::uuid = p_discipline_id)
    AND ((value ->> 'location_id') IS NULL OR (value ->> 'location_id')::uuid = p_location_id)
  ORDER BY
    (CASE WHEN value ->> 'discipline_id' IS NULL THEN 0 ELSE 1 END
     + CASE WHEN value ->> 'location_id' IS NULL THEN 0 ELSE 1 END) DESC,
    CASE WHEN value ->> 'discipline_id' IS NULL THEN 1 ELSE 0 END,
    CASE WHEN value ->> 'location_id' IS NULL THEN 1 ELSE 0 END
  LIMIT 1;

  SELECT value INTO v_tier
  FROM jsonb_array_elements(COALESCE(v_item -> 'attendance_tiers', '[]'::jsonb))
  WHERE (value ->> 'min_attendees')::integer <= p_attendee_count
    AND (
      NULLIF(value ->> 'max_attendees', '') IS NULL
      OR (value ->> 'max_attendees')::integer >= p_attendee_count
    )
  ORDER BY (value ->> 'min_attendees')::integer DESC
  LIMIT 1;

  RETURN COALESCE((v_tier ->> 'amount')::numeric, 0);
END;
$$;

CREATE OR REPLACE FUNCTION post_venue_cost_for_closure(
  p_closure_id uuid,
  p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_closure lesson_occurrence_closures%ROWTYPE;
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_amount numeric;
  v_accrual_id uuid;
BEGIN
  SELECT * INTO v_closure
  FROM lesson_occurrence_closures
  WHERE id = p_closure_id
  FOR UPDATE;

  IF NOT FOUND OR v_closure.status <> 'closed' THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'closure_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM venue_cost_accruals a
    WHERE a.organization_id = v_closure.organization_id
      AND a.closure_id = v_closure.id
      AND a.accrual_status = 'posted'
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  SELECT * INTO v_rule
  FROM venue_cost_rule_at(v_closure.organization_id, v_closure.occurrence_date);

  IF v_rule.id IS NULL THEN
    INSERT INTO venue_cost_accruals (
      organization_id, closure_id, accrual_kind, accrual_status, accrual_date,
      source_snapshot, created_by
    ) VALUES (
      v_closure.organization_id, v_closure.id, 'lesson', 'pending_unpriced',
      v_closure.occurrence_date, v_closure.source_snapshot, p_actor_id
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_accrual_id;

    UPDATE lesson_occurrence_closures
    SET pricing_status = 'pending_unpriced', rule_version_id = NULL
    WHERE id = v_closure.id;

    RETURN jsonb_build_object(
      'success', true, 'closure_id', v_closure.id, 'accrual_id', v_accrual_id,
      'pricing_status', 'pending_unpriced'
    );
  END IF;

  v_amount := venue_cost_amount_for_lesson(
    v_rule, v_closure.occurrence_kind, v_closure.discipline_id, v_closure.location_id,
    v_closure.confirmed_attendee_count
  );

  UPDATE venue_cost_accruals
  SET accrual_status = 'void', amount = 0,
      reason = 'resolved_by_rule:' || v_rule.id::text
  WHERE organization_id = v_closure.organization_id
    AND closure_id = v_closure.id
    AND accrual_status = 'pending_unpriced';

  INSERT INTO venue_cost_accruals (
    organization_id, rule_version_id, closure_id, accrual_kind, accrual_status,
    accrual_date, amount, currency, rule_snapshot, source_snapshot, created_by
  ) VALUES (
    v_closure.organization_id, v_rule.id, v_closure.id, 'lesson', 'posted',
    v_closure.occurrence_date, round(v_amount, 2),
    COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
    to_jsonb(v_rule), v_closure.source_snapshot, p_actor_id
  )
  RETURNING id INTO v_accrual_id;

  UPDATE lesson_occurrence_closures
  SET pricing_status = CASE WHEN v_rule.mode = 'per_lesson' THEN 'priced' ELSE 'not_applicable' END,
      rule_version_id = v_rule.id
  WHERE id = v_closure.id;

  RETURN jsonb_build_object(
    'success', true, 'closure_id', v_closure.id, 'accrual_id', v_accrual_id,
    'pricing_status', CASE WHEN v_rule.mode = 'per_lesson' THEN 'priced' ELSE 'not_applicable' END,
    'amount', round(v_amount, 2), 'rule_version_id', v_rule.id
  );
END;
$$;

-- =============================================================================
-- 3. Rule and occurrence RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION list_venue_cost_rule_versions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.version_number DESC), '[]'::jsonb)
  INTO v_rows
  FROM venue_cost_rule_versions r
  WHERE r.organization_id = v_org_id;
  RETURN jsonb_build_object('success', true, 'versions', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION save_venue_cost_rule_draft(
  p_payload jsonb,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_id uuid := NULLIF(p_payload ->> 'id', '')::uuid;
  v_version bigint;
  v_result jsonb;
  v_fingerprint text := md5(COALESCE(p_payload::text, ''));
  v_cached jsonb;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'save_venue_cost_rule_draft', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL
    OR current_member_role() NOT IN ('owner', 'director')
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  IF NOT venue_cost_rules_are_valid(
    p_payload ->> 'mode',
    COALESCE(p_payload -> 'rules', '{}'::jsonb)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule');
  END IF;

  IF NOT venue_cost_rule_references_are_valid(
    v_org_id,
    p_payload ->> 'mode',
    COALESCE(p_payload -> 'rules', '{}'::jsonb)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule_reference');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));

  IF v_id IS NULL THEN
    SELECT COALESCE(max(version_number), 0) + 1 INTO v_version
    FROM venue_cost_rule_versions WHERE organization_id = v_org_id;

    INSERT INTO venue_cost_rule_versions (
      organization_id, version_number, mode, valid_from, valid_to, rules, created_by
    ) VALUES (
      v_org_id, v_version, p_payload ->> 'mode',
      (p_payload ->> 'valid_from')::date,
      NULLIF(p_payload ->> 'valid_to', '')::date,
      COALESCE(p_payload -> 'rules', '{}'::jsonb), v_member_id
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE venue_cost_rule_versions
    SET mode = p_payload ->> 'mode',
        valid_from = (p_payload ->> 'valid_from')::date,
        valid_to = NULLIF(p_payload ->> 'valid_to', '')::date,
        rules = COALESCE(p_payload -> 'rules', '{}'::jsonb)
    WHERE id = v_id AND organization_id = v_org_id AND status = 'draft';
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error_code', 'draft_not_found');
    END IF;
  END IF;

  v_result := jsonb_build_object('success', true, 'rule_version_id', v_id);
  PERFORM store_operation_idempotency(v_org_id, 'save_venue_cost_rule_draft', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
EXCEPTION
  WHEN check_violation OR invalid_text_representation OR numeric_value_out_of_range THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule', 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION accept_venue_cost_rule_version(
  p_rule_version_id uuid,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rule venue_cost_rule_versions%ROWTYPE;
  v_cursor date;
  v_period_from date;
  v_period_to date;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(COALESCE(p_rule_version_id::text, ''));
  v_closure record;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL
    OR current_member_role() NOT IN ('owner', 'director')
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_org_id::text || ':venue-rules', 0));
  SELECT * INTO v_rule
  FROM venue_cost_rule_versions
  WHERE id = p_rule_version_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'rule_not_found');
  END IF;
  IF v_rule.status = 'accepted' THEN
    RETURN jsonb_build_object('success', true, 'rule_version_id', v_rule.id, 'already_applied', true);
  END IF;
  IF NOT venue_cost_rule_references_are_valid(v_org_id, v_rule.mode, v_rule.rules) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_rule_reference');
  END IF;
  IF EXISTS (
    SELECT 1 FROM venue_cost_rule_versions r
    WHERE r.organization_id = v_org_id AND r.status = 'accepted'
      AND daterange(r.valid_from, COALESCE(r.valid_to, 'infinity'::date), '[]')
          && daterange(v_rule.valid_from, COALESCE(v_rule.valid_to, 'infinity'::date), '[]')
  ) THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'accepted_rule_overlap');
  END IF;

  UPDATE venue_cost_rule_versions
  SET status = 'accepted', accepted_by = v_member_id, accepted_at = now()
  WHERE id = v_rule.id
  RETURNING * INTO v_rule;

  IF v_rule.mode = 'fixed_period' THEN
    v_cursor := v_rule.valid_from;
    WHILE v_cursor <= v_rule.valid_to LOOP
      v_period_from := v_cursor;
      IF v_rule.rules ->> 'period' = 'week' THEN
        v_period_to := LEAST(v_rule.valid_to, v_cursor + 6);
        v_cursor := v_period_to + 1;
      ELSIF v_rule.rules ->> 'period' = 'month' THEN
        v_period_to := LEAST(v_rule.valid_to, (date_trunc('month', v_cursor) + interval '1 month - 1 day')::date);
        v_cursor := v_period_to + 1;
      ELSE
        v_period_to := v_rule.valid_to;
        v_cursor := v_rule.valid_to + 1;
      END IF;

      INSERT INTO venue_cost_accruals (
        organization_id, rule_version_id, accrual_kind, accrual_status, accrual_date,
        period_from, period_to, amount, currency, rule_snapshot, source_snapshot, created_by
      ) VALUES (
        v_org_id, v_rule.id, 'fixed_period', 'posted', v_period_to,
        v_period_from, v_period_to, round((v_rule.rules ->> 'amount')::numeric, 2),
        COALESCE(NULLIF(v_rule.rules ->> 'currency', ''), 'RUB'),
        to_jsonb(v_rule), jsonb_build_object('period', v_rule.rules ->> 'period'), v_member_id
      );
    END LOOP;
  END IF;

  FOR v_closure IN
    SELECT c.id
    FROM lesson_occurrence_closures c
    WHERE c.organization_id = v_org_id
      AND c.status = 'closed'
      AND c.pricing_status = 'pending_unpriced'
      AND c.occurrence_date BETWEEN v_rule.valid_from AND COALESCE(v_rule.valid_to, 'infinity'::date)
    ORDER BY c.occurrence_date, c.id
  LOOP
    PERFORM post_venue_cost_for_closure(v_closure.id, v_member_id);
  END LOOP;

  v_result := jsonb_build_object('success', true, 'rule_version_id', v_rule.id);
  PERFORM store_operation_idempotency(v_org_id, 'accept_venue_cost_rule_version', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION member_can_close_group_venue_occurrence(
  p_schedule_slot_id uuid,
  p_occurrence_date date
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_slot schedule_slots%ROWTYPE;
  v_role text := current_member_role();
BEGIN
  IF auth.uid() IS NULL OR auth_organization_id() IS NULL
    OR NOT organization_allows_writes(auth_organization_id())
  THEN
    RETURN false;
  END IF;

  SELECT * INTO v_slot
  FROM schedule_slots s
  WHERE s.id = p_schedule_slot_id
    AND s.organization_id = auth_organization_id();
  IF NOT FOUND THEN RETURN false; END IF;

  IF can_read_financial() THEN RETURN true; END IF;
  IF v_role = 'teacher' THEN
    RETURN teacher_can_mark_group_attendance(p_occurrence_date, v_slot.class_id);
  END IF;
  IF v_role = 'admin' OR can_write_reception() THEN
    RETURN member_can_access_attendance_journal();
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION member_can_close_personal_venue_occurrence(
  p_personal_lesson_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_role text := current_member_role();
BEGIN
  IF auth.uid() IS NULL OR auth_organization_id() IS NULL
    OR NOT organization_allows_writes(auth_organization_id())
  THEN
    RETURN false;
  END IF;
  IF can_read_financial() THEN RETURN true; END IF;
  IF v_role = 'admin' THEN
    RETURN member_can_cancel_personal_lesson(p_personal_lesson_id);
  END IF;
  IF v_role = 'teacher' THEN
    RETURN teacher_can_access_lesson(p_personal_lesson_id);
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION close_group_lesson_occurrence(
  p_schedule_slot_id uuid,
  p_occurrence_date date,
  p_confirmed_attendee_count integer,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_slot schedule_slots%ROWTYPE;
  v_closure_id uuid;
  v_existing_attendee_count integer;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(concat_ws('|', p_schedule_slot_id, p_occurrence_date, p_confirmed_attendee_count));
  v_cached := check_operation_idempotency(v_org_id, 'close_group_lesson_occurrence', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL
    OR NOT member_can_close_group_venue_occurrence(p_schedule_slot_id, p_occurrence_date)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_occurrence_date IS NULL OR p_occurrence_date > current_date
    OR p_confirmed_attendee_count IS NULL OR p_confirmed_attendee_count < 0
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_occurrence');
  END IF;

  SELECT * INTO v_slot FROM schedule_slots s
  WHERE s.id = p_schedule_slot_id AND s.organization_id = v_org_id
    AND s.class_id IS NOT NULL
    AND s.day_of_week = EXTRACT(ISODOW FROM p_occurrence_date)::integer
    AND s.valid_from <= p_occurrence_date
    AND (s.valid_to IS NULL OR s.valid_to >= p_occurrence_date);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'group_occurrence_not_found');
  END IF;

  SELECT id, confirmed_attendee_count INTO v_closure_id, v_existing_attendee_count
  FROM lesson_occurrence_closures
  WHERE organization_id = v_org_id AND schedule_slot_id = v_slot.id
    AND occurrence_date = p_occurrence_date AND status = 'closed';
  IF v_closure_id IS NOT NULL THEN
    IF v_existing_attendee_count IS DISTINCT FROM p_confirmed_attendee_count THEN
      RETURN jsonb_build_object(
        'success', false, 'error_code', 'closure_attendee_count_conflict',
        'closure_id', v_closure_id,
        'confirmed_attendee_count', v_existing_attendee_count
      );
    END IF;
    RETURN jsonb_build_object('success', true, 'closure_id', v_closure_id, 'already_applied', true);
  END IF;

  INSERT INTO lesson_occurrence_closures (
    organization_id, occurrence_kind, occurrence_date, schedule_slot_id,
    discipline_id, location_id, confirmed_attendee_count, source_snapshot, closed_by
  ) VALUES (
    v_org_id, 'group', p_occurrence_date, v_slot.id, v_slot.discipline_id,
    v_slot.location_id, p_confirmed_attendee_count,
    jsonb_build_object(
      'schedule_slot_id', v_slot.id, 'class_id', v_slot.class_id,
      'discipline_id', v_slot.discipline_id, 'location_id', v_slot.location_id,
      'confirmed_attendee_count', p_confirmed_attendee_count
    ), v_member_id
  ) RETURNING id INTO v_closure_id;

  v_result := post_venue_cost_for_closure(v_closure_id, v_member_id);
  IF NOT can_read_financial() THEN
    v_result := v_result - 'amount';
  END IF;
  PERFORM store_operation_idempotency(v_org_id, 'close_group_lesson_occurrence', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION close_personal_lesson_occurrence(
  p_personal_lesson_id uuid,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_lesson personal_lessons%ROWTYPE;
  v_closure_id uuid;
  v_fingerprint text := md5(COALESCE(p_personal_lesson_id::text, ''));
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'close_personal_lesson_occurrence', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL
    OR NOT member_can_close_personal_venue_occurrence(p_personal_lesson_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  SELECT * INTO v_lesson FROM personal_lessons p
  WHERE p.id = p_personal_lesson_id AND p.organization_id = v_org_id
    AND p.date <= current_date AND p.cancelled_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'personal_lesson_not_found');
  END IF;

  SELECT id INTO v_closure_id FROM lesson_occurrence_closures
  WHERE organization_id = v_org_id
    AND source_personal_lesson_id = v_lesson.id
    AND status = 'closed';
  IF v_closure_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'closure_id', v_closure_id, 'already_applied', true);
  END IF;

  INSERT INTO lesson_occurrence_closures (
    organization_id, occurrence_kind, occurrence_date, personal_lesson_id,
    source_personal_lesson_id,
    discipline_id, location_id, source_snapshot, closed_by
  ) VALUES (
    v_org_id, 'personal', v_lesson.date, v_lesson.id, v_lesson.id, v_lesson.discipline_id,
    v_lesson.location_id, to_jsonb(v_lesson), v_member_id
  ) RETURNING id INTO v_closure_id;

  v_result := post_venue_cost_for_closure(v_closure_id, v_member_id);
  IF NOT can_read_financial() THEN
    v_result := v_result - 'amount';
  END IF;
  PERFORM store_operation_idempotency(v_org_id, 'close_personal_lesson_occurrence', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION reopen_lesson_occurrence_closure(
  p_closure_id uuid,
  p_reason text,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_closure lesson_occurrence_closures%ROWTYPE;
  v_accrual venue_cost_accruals%ROWTYPE;
  v_adjustment_id uuid;
  v_result jsonb;
  v_fingerprint text := md5(concat_ws('|', p_closure_id, p_reason));
  v_cached jsonb;
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'reopen_lesson_occurrence_closure', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'reason_required');
  END IF;

  SELECT * INTO v_closure FROM lesson_occurrence_closures
  WHERE id = p_closure_id AND organization_id = v_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'closure_not_found');
  END IF;
  IF v_closure.status = 'reopened' THEN
    RETURN jsonb_build_object('success', true, 'closure_id', v_closure.id, 'already_applied', true);
  END IF;

  SELECT * INTO v_accrual FROM venue_cost_accruals a
  WHERE a.organization_id = v_org_id AND a.closure_id = v_closure.id
    AND a.accrual_status = 'posted' AND a.accrual_kind = 'lesson'
  ORDER BY a.created_at DESC LIMIT 1;

  IF v_accrual.id IS NOT NULL AND v_accrual.amount <> 0 THEN
    INSERT INTO venue_cost_accruals (
      organization_id, rule_version_id, closure_id, accrual_kind, accrual_status,
      accrual_date, amount, currency, adjusts_accrual_id, rule_snapshot,
      source_snapshot, reason, created_by
    ) VALUES (
      v_org_id, v_accrual.rule_version_id, v_closure.id, 'adjustment', 'posted',
      v_accrual.accrual_date, -v_accrual.amount, v_accrual.currency, v_accrual.id,
      v_accrual.rule_snapshot, v_accrual.source_snapshot, trim(p_reason), v_member_id
    ) RETURNING id INTO v_adjustment_id;
  ELSE
    UPDATE venue_cost_accruals
    SET accrual_status = 'void', amount = COALESCE(amount, 0), reason = trim(p_reason)
    WHERE organization_id = v_org_id AND closure_id = v_closure.id
      AND accrual_status = 'pending_unpriced';
  END IF;

  UPDATE lesson_occurrence_closures
  SET status = 'reopened', pricing_status = 'reversed', reopened_by = v_member_id,
      reopened_at = now(), reopen_reason = trim(p_reason)
  WHERE id = v_closure.id;

  v_result := jsonb_build_object(
    'success', true, 'closure_id', v_closure.id, 'adjustment_id', v_adjustment_id
  );
  PERFORM store_operation_idempotency(v_org_id, 'reopen_lesson_occurrence_closure', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION recalculate_pending_venue_costs(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_row record;
  v_count integer := 0;
  v_result jsonb;
  v_cached jsonb;
  v_fingerprint text := md5(concat_ws('|', p_date_from, p_date_to));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'recalculate_pending_venue_costs', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN RETURN v_cached || jsonb_build_object('already_applied', true); END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;

  FOR v_row IN
    SELECT c.id
    FROM lesson_occurrence_closures c
    WHERE c.organization_id = v_org_id AND c.status = 'closed'
      AND c.pricing_status = 'pending_unpriced'
      AND (p_date_from IS NULL OR c.occurrence_date >= p_date_from)
      AND (p_date_to IS NULL OR c.occurrence_date <= p_date_to)
      AND EXISTS (
        SELECT 1 FROM venue_cost_rule_versions r
        WHERE r.organization_id = v_org_id AND r.status = 'accepted'
          AND r.valid_from <= c.occurrence_date
          AND (r.valid_to IS NULL OR r.valid_to >= c.occurrence_date)
      )
    ORDER BY c.occurrence_date, c.id
  LOOP
    PERFORM post_venue_cost_for_closure(v_row.id, v_member_id);
    v_count := v_count + 1;
  END LOOP;

  v_result := jsonb_build_object('success', true, 'resolved_count', v_count);
  PERFORM store_operation_idempotency(v_org_id, 'recalculate_pending_venue_costs', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 4. Payment expiry acknowledgement wrappers
-- =============================================================================

ALTER FUNCTION record_subscription_payment(uuid, numeric, text, text, uuid)
  RENAME TO _record_subscription_payment_before_venue_rules;
ALTER FUNCTION record_personal_lesson_payment(uuid, numeric, text, uuid)
  RENAME TO _record_personal_lesson_payment_before_venue_rules;
ALTER FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid)
  RENAME TO _record_single_visit_before_venue_rules;

DROP FUNCTION IF EXISTS record_subscription_payment(uuid, numeric, text);
DROP FUNCTION IF EXISTS record_subscription_payment(uuid, numeric, text, text);
DROP FUNCTION IF EXISTS record_personal_lesson_payment(uuid, numeric, text);
DROP FUNCTION IF EXISTS record_single_visit(date, uuid, uuid, uuid, text);

REVOKE ALL ON FUNCTION _record_subscription_payment_before_venue_rules(uuid, numeric, text, text, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION _record_personal_lesson_payment_before_venue_rules(uuid, numeric, text, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION _record_single_visit_before_venue_rules(date, uuid, uuid, uuid, text, uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION store_venue_payment_ack_if_required(
  p_status jsonb,
  p_payment_id uuid,
  p_scope text,
  p_idempotency_key uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
BEGIN
  IF COALESCE((p_status ->> 'acknowledgement_required')::boolean, false)
    AND p_payment_id IS NOT NULL
  THEN
    INSERT INTO venue_rule_payment_acknowledgements (
      organization_id, payment_id, operation_scope, idempotency_key,
      expired_rule_id, acknowledged_by, status_snapshot
    ) VALUES (
      v_org_id, p_payment_id, p_scope, p_idempotency_key,
      (p_status ->> 'latest_rule_id')::uuid, auth_member_id(), p_status
    )
    ON CONFLICT (organization_id, payment_id) DO NOTHING;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_fingerprint text := md5(concat_ws('|', p_subscription_id, p_amount, p_method, p_method_comment, p_venue_rule_acknowledged));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_subscription_payment',
        p_idempotency_key,
        md5(
          coalesce(p_subscription_id::text, '') || '|' ||
          coalesce(p_amount::text, '') || '|' ||
          coalesce(p_method, '') || '|' ||
          coalesce(p_method_comment, '')
        )
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN RETURN v_cached; END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;
  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
    );
  END IF;
  SELECT p.id INTO v_existing_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.subscription_id = p_subscription_id
    AND p.personal_lesson_id IS NULL
    AND p.single_visit_id IS NULL
    AND p.operation_kind = 'payment'
  LIMIT 1;
  v_result := _record_subscription_payment_before_venue_rules(
    p_subscription_id, p_amount, p_method, p_method_comment, p_idempotency_key
  );
  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status, (v_result ->> 'payment_id')::uuid, 'record_subscription_payment', p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_fingerprint text := md5(concat_ws('|', p_lesson_id, p_amount, p_method, p_venue_rule_acknowledged));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_personal_lesson_payment',
        p_idempotency_key,
        md5(
          coalesce(p_lesson_id::text, '') || '|' ||
          coalesce(p_amount::text, '') || '|' ||
          coalesce(p_method, '')
        )
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN RETURN v_cached; END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;
  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
    );
  END IF;
  SELECT p.id INTO v_existing_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.personal_lesson_id = p_lesson_id
    AND p.operation_kind = 'payment'
    AND p.replaces_payment_id IS NULL
    AND payment_remaining_amount(v_org_id, p.id) > 0
  ORDER BY p.created_at
  LIMIT 1;
  v_result := _record_personal_lesson_payment_before_venue_rules(
    p_lesson_id, p_amount, p_method, p_idempotency_key
  );
  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status, (v_result ->> 'payment_id')::uuid, 'record_personal_lesson_payment', p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION record_single_visit(
  p_visit_date date,
  p_schedule_slot_id uuid,
  p_client_id uuid,
  p_price_id uuid,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_status jsonb;
  v_result jsonb;
  v_cached jsonb;
  v_existing_payment_id uuid;
  v_fingerprint text := md5(concat_ws(
    '|', p_visit_date, p_schedule_slot_id, p_client_id, p_price_id, p_method, p_venue_rule_acknowledged
  ));
BEGIN
  v_cached := check_operation_idempotency(v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_single_visit',
        p_idempotency_key,
        md5(
          coalesce(p_visit_date::text, '') || '|' ||
          coalesce(p_schedule_slot_id::text, '') || '|' ||
          coalesce(p_client_id::text, '') || '|' ||
          coalesce(p_price_id::text, '') || '|' ||
          coalesce(p_method, '')
        )
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN RETURN v_cached; END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;
  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false, 'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required', 'venue_rule_status', v_status
    );
  END IF;
  SELECT p.id INTO v_existing_payment_id
  FROM single_visits sv
  JOIN payments p
    ON p.organization_id = sv.organization_id
   AND p.single_visit_id = sv.id
   AND p.operation_kind = 'payment'
   AND p.replaces_payment_id IS NULL
  WHERE sv.organization_id = v_org_id
    AND sv.visit_date = p_visit_date
    AND sv.schedule_slot_id = p_schedule_slot_id
    AND sv.client_id = p_client_id
    AND payment_remaining_amount(v_org_id, p.id) > 0
  LIMIT 1;
  v_result := _record_single_visit_before_venue_rules(
    p_visit_date, p_schedule_slot_id, p_client_id, p_price_id, p_method, p_idempotency_key
  );
  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status, (v_result ->> 'payment_id')::uuid, 'record_single_visit', p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(v_org_id, 'record_single_visit', p_idempotency_key, v_fingerprint, v_result);
  END IF;
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 5. Unified finance reporting
-- =============================================================================

CREATE VIEW finance_cost_entries_v
WITH (security_invoker = true)
AS
SELECT
  e.organization_id,
  e.id,
  'manual_expense'::text AS source_type,
  e.expense_date AS entry_date,
  e.amount::numeric(14,2) AS amount,
  e.category,
  e.description,
  NULL::uuid AS rule_version_id,
  NULL::uuid AS closure_id,
  e.created_at
FROM expenses e
UNION ALL
SELECT
  a.organization_id,
  a.id,
  'venue_cost'::text AS source_type,
  a.accrual_date AS entry_date,
  a.amount,
  'venue'::text AS category,
  COALESCE(a.reason, a.accrual_kind),
  a.rule_version_id,
  a.closure_id,
  a.created_at
FROM venue_cost_accruals a
WHERE a.accrual_status = 'posted';

CREATE OR REPLACE FUNCTION get_finance_costs(
  p_date_from date,
  p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_entries jsonb;
  v_summary jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL OR NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'forbidden');
  END IF;
  IF p_date_from IS NULL OR p_date_to IS NULL OR p_date_to < p_date_from THEN
    RETURN jsonb_build_object('success', false, 'error_code', 'invalid_period');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date DESC, x.created_at DESC), '[]'::jsonb)
  INTO v_entries
  FROM (
    SELECT id, source_type, entry_date, amount, category, description,
           rule_version_id, closure_id, created_at
    FROM finance_cost_entries_v
    WHERE organization_id = v_org_id AND entry_date BETWEEN p_date_from AND p_date_to
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY m.month), '[]'::jsonb)
  INTO v_summary
  FROM (
    SELECT
      to_char(date_trunc('month', entry_date), 'YYYY-MM') AS month,
      COALESCE(sum(amount) FILTER (WHERE source_type = 'manual_expense'), 0)::numeric(14,2) AS manual_total,
      COALESCE(sum(amount) FILTER (WHERE source_type = 'venue_cost'), 0)::numeric(14,2) AS venue_total,
      COALESCE(sum(amount), 0)::numeric(14,2) AS total
    FROM finance_cost_entries_v
    WHERE organization_id = v_org_id AND entry_date BETWEEN p_date_from AND p_date_to
    GROUP BY date_trunc('month', entry_date)
  ) m;

  RETURN jsonb_build_object(
    'success', true, 'entries', v_entries, 'monthly_summary', v_summary,
    'manual_total', COALESCE((
      SELECT sum(amount) FROM finance_cost_entries_v
      WHERE organization_id = v_org_id AND source_type = 'manual_expense'
        AND entry_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'venue_total', COALESCE((
      SELECT sum(amount) FROM finance_cost_entries_v
      WHERE organization_id = v_org_id AND source_type = 'venue_cost'
        AND entry_date BETWEEN p_date_from AND p_date_to
    ), 0),
    'total', COALESCE((
      SELECT sum(amount) FROM finance_cost_entries_v
      WHERE organization_id = v_org_id AND entry_date BETWEEN p_date_from AND p_date_to
    ), 0)
  );
END;
$$;

-- =============================================================================
-- 6. Audit, RLS and grants
-- =============================================================================

CREATE TRIGGER audit_venue_cost_rule_versions
  AFTER INSERT OR UPDATE OR DELETE ON venue_cost_rule_versions
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_lesson_occurrence_closures
  AFTER INSERT OR UPDATE OR DELETE ON lesson_occurrence_closures
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_venue_cost_accruals
  AFTER INSERT OR UPDATE OR DELETE ON venue_cost_accruals
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
CREATE TRIGGER audit_venue_rule_payment_acknowledgements
  AFTER INSERT OR UPDATE OR DELETE ON venue_rule_payment_acknowledgements
  FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();

ALTER TABLE venue_cost_rule_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE lesson_occurrence_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_cost_accruals ENABLE ROW LEVEL SECURITY;
ALTER TABLE venue_rule_payment_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_cost_rules_select ON venue_cost_rule_versions
  FOR SELECT TO authenticated
  USING (organization_id = auth_organization_id() AND business_row_readable() AND can_read_financial());
CREATE POLICY venue_cost_rules_write_none ON venue_cost_rule_versions
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY lesson_occurrence_closures_select ON lesson_occurrence_closures
  FOR SELECT TO authenticated
  USING (organization_id = auth_organization_id() AND business_row_readable() AND can_read_financial());
CREATE POLICY lesson_occurrence_closures_write_none ON lesson_occurrence_closures
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY venue_cost_accruals_select ON venue_cost_accruals
  FOR SELECT TO authenticated
  USING (organization_id = auth_organization_id() AND business_row_readable() AND can_read_financial());
CREATE POLICY venue_cost_accruals_write_none ON venue_cost_accruals
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY venue_rule_payment_acks_select ON venue_rule_payment_acknowledgements
  FOR SELECT TO authenticated
  USING (organization_id = auth_organization_id() AND business_row_readable() AND can_read_financial());
CREATE POLICY venue_rule_payment_acks_write_none ON venue_rule_payment_acknowledgements
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

REVOKE ALL ON venue_cost_rule_versions, lesson_occurrence_closures,
  venue_cost_accruals, venue_rule_payment_acknowledgements FROM PUBLIC, anon;
GRANT SELECT ON venue_cost_rule_versions, lesson_occurrence_closures,
  venue_cost_accruals, venue_rule_payment_acknowledgements TO authenticated;
REVOKE ALL ON finance_cost_entries_v FROM PUBLIC, anon;
GRANT SELECT ON finance_cost_entries_v TO authenticated;

REVOKE ALL ON FUNCTION get_venue_cost_rule_status(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_venue_cost_rule_status(date) TO authenticated;
REVOKE ALL ON FUNCTION venue_cost_status_for_org(uuid, date) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION venue_cost_rule_at(uuid, date) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION venue_cost_rule_references_are_valid(uuid, text, jsonb) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION post_venue_cost_for_closure(uuid, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION store_venue_payment_ack_if_required(jsonb, uuid, text, uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION member_can_close_group_venue_occurrence(uuid, date) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION member_can_close_personal_venue_occurrence(uuid) FROM PUBLIC, authenticated;
REVOKE ALL ON FUNCTION list_venue_cost_rule_versions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_venue_cost_rule_versions() TO authenticated;
REVOKE ALL ON FUNCTION save_venue_cost_rule_draft(jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_venue_cost_rule_draft(jsonb, uuid) TO authenticated;
REVOKE ALL ON FUNCTION accept_venue_cost_rule_version(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_venue_cost_rule_version(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION close_group_lesson_occurrence(uuid, date, integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_group_lesson_occurrence(uuid, date, integer, uuid) TO authenticated;
REVOKE ALL ON FUNCTION close_personal_lesson_occurrence(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_personal_lesson_occurrence(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION reopen_lesson_occurrence_closure(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reopen_lesson_occurrence_closure(uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION recalculate_pending_venue_costs(date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION recalculate_pending_venue_costs(date, date, uuid) TO authenticated;
REVOKE ALL ON FUNCTION get_finance_costs(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_finance_costs(date, date) TO authenticated;

REVOKE ALL ON FUNCTION record_subscription_payment(uuid, numeric, text, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_subscription_payment(uuid, numeric, text, text, uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION record_personal_lesson_payment(uuid, numeric, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_personal_lesson_payment(uuid, numeric, text, uuid, boolean) TO authenticated;
REVOKE ALL ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_single_visit(date, uuid, uuid, uuid, text, uuid, boolean) TO authenticated;

COMMIT;
