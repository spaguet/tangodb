-- Long-term rental with hourly/fixed tariffs, series, invoices, advances, deposits
-- CRM scenario 14 / Prompt 14

BEGIN;

-- =============================================================================
-- 1. Schema
-- =============================================================================

CREATE TABLE rental_tariffs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  tariff_type           TEXT NOT NULL CHECK (tariff_type IN ('hourly', 'fixed')),
  location_id           UUID,
  price                 NUMERIC(12, 2) NOT NULL CHECK (price >= 0),
  currency              TEXT NOT NULL DEFAULT 'RUB',
  min_duration_minutes  INT NOT NULL DEFAULT 0 CHECK (min_duration_minutes >= 0),
  rounding_step_minutes INT NOT NULL DEFAULT 1 CHECK (rounding_step_minutes >= 1),
  valid_from            DATE,
  valid_to              DATE,
  status                TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id),
  CHECK (length(trim(name)) > 0),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK (
    tariff_type = 'fixed'
    OR (min_duration_minutes >= 0 AND rounding_step_minutes >= 1)
  )
);

CREATE INDEX idx_rental_tariffs_org_status
  ON rental_tariffs (organization_id, status, name);

CREATE INDEX idx_rental_tariffs_org_location
  ON rental_tariffs (organization_id, location_id)
  WHERE location_id IS NOT NULL;

CREATE TABLE rental_tariff_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  tariff_id       UUID NOT NULL,
  priority        INT NOT NULL DEFAULT 0,
  days_of_week    INT[] NOT NULL CHECK (cardinality(days_of_week) > 0),
  time_start      TEXT NOT NULL,
  time_end        TEXT NOT NULL,
  price_override  NUMERIC(12, 2) NOT NULL CHECK (price_override >= 0),
  valid_from      DATE,
  valid_to        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, tariff_id)
    REFERENCES rental_tariffs (organization_id, id) ON DELETE CASCADE,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from),
  CHECK (_hhmm_to_minutes(time_end) > _hhmm_to_minutes(time_start)),
  CHECK (
    days_of_week <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::INT[]
    AND NOT (0 = ANY (days_of_week))
  )
);

CREATE INDEX idx_rental_tariff_rules_tariff
  ON rental_tariff_rules (organization_id, tariff_id, priority DESC);

CREATE TABLE rental_series (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id       UUID NOT NULL,
  contract_id     UUID,
  location_id     UUID NOT NULL,
  tariff_id       UUID NOT NULL,
  valid_from      DATE NOT NULL,
  valid_to        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled', 'completed')),
  purpose         TEXT,
  idempotency_key TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id),
  FOREIGN KEY (organization_id, contract_id)
    REFERENCES renter_contracts (organization_id, id),
  FOREIGN KEY (organization_id, location_id)
    REFERENCES locations (organization_id, id),
  FOREIGN KEY (organization_id, tariff_id)
    REFERENCES rental_tariffs (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (valid_to >= valid_from),
  CHECK (valid_from >= DATE '2000-01-01')
);

CREATE UNIQUE INDEX rental_series_org_idempotency_unique
  ON rental_series (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_rental_series_org_renter
  ON rental_series (organization_id, renter_id, status);

CREATE TABLE rental_series_patterns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  series_id       UUID NOT NULL,
  days_of_week    INT[] NOT NULL CHECK (cardinality(days_of_week) > 0),
  time_start      TEXT NOT NULL,
  time_end        TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, series_id)
    REFERENCES rental_series (organization_id, id) ON DELETE CASCADE,
  CHECK (_hhmm_to_minutes(time_end) > _hhmm_to_minutes(time_start)),
  CHECK (
    days_of_week <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::INT[]
    AND NOT (0 = ANY (days_of_week))
  )
);

CREATE INDEX idx_rental_series_patterns_series
  ON rental_series_patterns (organization_id, series_id);

ALTER TABLE rentals
  ADD COLUMN IF NOT EXISTS rental_series_id UUID,
  ADD COLUMN IF NOT EXISTS tariff_id UUID,
  ADD COLUMN IF NOT EXISTS tariff_type TEXT
    CHECK (tariff_type IS NULL OR tariff_type IN ('hourly', 'fixed')),
  ADD COLUMN IF NOT EXISTS tariff_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS pricing_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS calculated_amount NUMERIC(12, 2)
    CHECK (calculated_amount IS NULL OR calculated_amount >= 0),
  ADD COLUMN IF NOT EXISTS adjustment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS final_amount NUMERIC(12, 2)
    CHECK (final_amount IS NULL OR final_amount >= 0);

ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_series_fk;
ALTER TABLE rentals
  ADD CONSTRAINT rentals_series_fk
  FOREIGN KEY (organization_id, rental_series_id)
  REFERENCES rental_series (organization_id, id);

ALTER TABLE rentals DROP CONSTRAINT IF EXISTS rentals_tariff_fk;
ALTER TABLE rentals
  ADD CONSTRAINT rentals_tariff_fk
  FOREIGN KEY (organization_id, tariff_id)
  REFERENCES rental_tariffs (organization_id, id);

CREATE INDEX idx_rentals_org_series
  ON rentals (organization_id, rental_series_id)
  WHERE rental_series_id IS NOT NULL;

CREATE TABLE rental_series_exceptions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  series_id        UUID NOT NULL,
  exception_date   DATE NOT NULL,
  reason           TEXT NOT NULL,
  financial_action TEXT NOT NULL DEFAULT 'none'
    CHECK (financial_action IN ('none', 'full_penalty', 'partial_penalty', 'manual')),
  penalty_amount   NUMERIC(12, 2) CHECK (penalty_amount IS NULL OR penalty_amount >= 0),
  cancelled_by     UUID,
  cancelled_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, series_id, exception_date),
  FOREIGN KEY (organization_id, series_id)
    REFERENCES rental_series (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, cancelled_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (length(trim(reason)) > 0),
  CHECK (
    financial_action <> 'partial_penalty'
    OR (penalty_amount IS NOT NULL AND penalty_amount > 0)
  )
);

CREATE TABLE rental_invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id       UUID NOT NULL,
  series_id       UUID,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  due_date        DATE NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'invoiced', 'partially_paid', 'paid', 'overdue', 'cancelled')),
  currency        TEXT NOT NULL DEFAULT 'RUB',
  total_amount    NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  idempotency_key TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id),
  FOREIGN KEY (organization_id, series_id)
    REFERENCES rental_series (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX rental_invoices_org_idempotency_unique
  ON rental_invoices (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_rental_invoices_org_renter
  ON rental_invoices (organization_id, renter_id, status);

CREATE TABLE rental_invoice_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  invoice_id      UUID NOT NULL,
  rental_id       UUID,
  line_type       TEXT NOT NULL
    CHECK (line_type IN ('booking', 'adjustment', 'penalty')),
  description     TEXT NOT NULL,
  amount          NUMERIC(12, 2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES rental_invoices (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, rental_id)
    REFERENCES rentals (organization_id, id),
  CHECK (length(trim(description)) > 0)
);

CREATE INDEX idx_rental_invoice_lines_invoice
  ON rental_invoice_lines (organization_id, invoice_id);

CREATE INDEX idx_rental_invoice_lines_rental
  ON rental_invoice_lines (organization_id, rental_id)
  WHERE rental_id IS NOT NULL;

CREATE TABLE rental_invoice_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  invoice_id      UUID NOT NULL,
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  currency        TEXT NOT NULL DEFAULT 'RUB',
  method          TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  idempotency_key TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES rental_invoices (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX rental_invoice_payments_org_idempotency_unique
  ON rental_invoice_payments (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_rental_invoice_payments_invoice
  ON rental_invoice_payments (organization_id, invoice_id);

CREATE TABLE rental_advances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id        UUID NOT NULL,
  amount           NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  allocated_amount NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (allocated_amount >= 0),
  currency         TEXT NOT NULL DEFAULT 'RUB',
  method           TEXT NOT NULL DEFAULT 'cash'
    CHECK (method IN ('cash', 'transfer', 'card', 'other')),
  idempotency_key  TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (allocated_amount <= amount)
);

CREATE UNIQUE INDEX rental_advances_org_idempotency_unique
  ON rental_advances (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_rental_advances_org_renter
  ON rental_advances (organization_id, renter_id);

CREATE TABLE rental_advance_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  advance_id      UUID NOT NULL,
  invoice_id      UUID NOT NULL,
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  allocated_by    UUID,
  allocated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at    TIMESTAMPTZ,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, advance_id)
    REFERENCES rental_advances (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES rental_invoices (organization_id, id),
  FOREIGN KEY (organization_id, allocated_by)
    REFERENCES organization_members (organization_id, id)
);

CREATE INDEX idx_rental_advance_allocations_advance
  ON rental_advance_allocations (organization_id, advance_id)
  WHERE cancelled_at IS NULL;

CREATE TABLE rental_deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id       UUID NOT NULL,
  contract_id     UUID,
  required_amount NUMERIC(12, 2) NOT NULL CHECK (required_amount >= 0),
  balance         NUMERIC(12, 2) NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'RUB',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id),
  FOREIGN KEY (organization_id, contract_id)
    REFERENCES renter_contracts (organization_id, id)
);

CREATE INDEX idx_rental_deposits_org_renter
  ON rental_deposits (organization_id, renter_id);

CREATE TABLE rental_deposit_movements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  deposit_id      UUID NOT NULL,
  movement_type   TEXT NOT NULL
    CHECK (movement_type IN ('receive', 'hold', 'return', 'apply_to_invoice')),
  amount          NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
  reason          TEXT NOT NULL,
  invoice_id      UUID,
  idempotency_key TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, deposit_id)
    REFERENCES rental_deposits (organization_id, id),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES rental_invoices (organization_id, id),
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (length(trim(reason)) > 0),
  CHECK (
    movement_type <> 'apply_to_invoice'
    OR invoice_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX rental_deposit_movements_org_idempotency_unique
  ON rental_deposit_movements (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_rental_deposit_movements_deposit
  ON rental_deposit_movements (organization_id, deposit_id);

CREATE TABLE rental_pricing_adjustments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  rental_id       UUID NOT NULL,
  old_amount      NUMERIC(12, 2) NOT NULL,
  new_amount      NUMERIC(12, 2) NOT NULL CHECK (new_amount >= 0),
  reason          TEXT NOT NULL,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, rental_id)
    REFERENCES rentals (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by)
    REFERENCES organization_members (organization_id, id),
  CHECK (length(trim(reason)) > 0)
);

CREATE INDEX idx_rental_pricing_adjustments_rental
  ON rental_pricing_adjustments (organization_id, rental_id, created_at DESC);

-- =============================================================================
-- 2. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION _org_timezone(p_org_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(trim(os.timezone), ''), 'UTC')
  FROM organization_settings os
  WHERE os.organization_id = p_org_id;
$$;

CREATE OR REPLACE FUNCTION _rental_effective_amount(p_fixed numeric, p_final numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT COALESCE(p_final, p_fixed, 0);
$$;

CREATE OR REPLACE FUNCTION _round_rental_minutes(
  p_minutes integer,
  p_min_duration integer,
  p_rounding_step integer
)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_minutes integer := GREATEST(COALESCE(p_minutes, 0), 0);
  v_min_dur integer := GREATEST(COALESCE(p_min_duration, 0), 0);
  v_step integer := GREATEST(COALESCE(p_rounding_step, 1), 1);
BEGIN
  IF v_minutes <= 0 THEN
    RETURN 0;
  END IF;

  IF v_minutes < v_min_dur THEN
    v_minutes := v_min_dur;
  END IF;

  IF v_step > 1 THEN
    v_minutes := ((v_minutes + v_step - 1) / v_step) * v_step;
  END IF;

  RETURN v_minutes;
END;
$$;

CREATE OR REPLACE FUNCTION _tariff_rule_applies(
  p_rule rental_tariff_rules,
  p_date date,
  p_time_start text,
  p_time_end text
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_dow integer;
  v_rs text;
  v_re text;
BEGIN
  IF p_date IS NOT NULL THEN
    IF p_rule.valid_from IS NOT NULL AND p_date < p_rule.valid_from THEN
      RETURN false;
    END IF;
    IF p_rule.valid_to IS NOT NULL AND p_date > p_rule.valid_to THEN
      RETURN false;
    END IF;
    v_dow := EXTRACT(ISODOW FROM p_date)::integer;
    IF NOT (v_dow = ANY (p_rule.days_of_week)) THEN
      RETURN false;
    END IF;
  END IF;

  v_rs := normalize_hhmm(p_rule.time_start);
  v_re := normalize_hhmm(p_rule.time_end);
  RETURN schedule_time_ranges_overlap(v_rs, v_re, p_time_start, p_time_end);
END;
$$;

CREATE OR REPLACE FUNCTION _calculate_rental_pricing(
  p_tariff_id uuid,
  p_org_id uuid,
  p_rental_date date,
  p_time_start text,
  p_time_end text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_tariff rental_tariffs%ROWTYPE;
  v_ts text;
  v_te text;
  v_raw_minutes integer;
  v_billable_minutes integer;
  v_segments jsonb := '[]'::jsonb;
  v_breakdown jsonb := '[]'::jsonb;
  v_calculated numeric(12, 2) := 0;
  v_snapshot jsonb;
  v_boundaries integer[];
  v_boundary integer;
  v_seg_start integer;
  v_seg_end integer;
  v_rule rental_tariff_rules%ROWTYPE;
  v_best_rule rental_tariff_rules%ROWTYPE;
  v_best_found boolean;
  v_rate numeric(12, 2);
  v_seg_minutes integer;
  v_seg_amount numeric(12, 2);
  v_i integer;
BEGIN
  SELECT * INTO v_tariff
  FROM rental_tariffs rt
  WHERE rt.id = p_tariff_id AND rt.organization_id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.notFound');
  END IF;

  IF v_tariff.status <> 'active' THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.inactive');
  END IF;

  IF v_tariff.valid_from IS NOT NULL AND p_rental_date < v_tariff.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.outOfRange');
  END IF;

  IF v_tariff.valid_to IS NOT NULL AND p_rental_date > v_tariff.valid_to THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.outOfRange');
  END IF;

  v_ts := normalize_hhmm(p_time_start);
  v_te := normalize_hhmm(p_time_end);

  IF _hhmm_to_minutes(v_te) <= _hhmm_to_minutes(v_ts) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  v_snapshot := jsonb_build_object(
    'tariff_id', v_tariff.id,
    'name', v_tariff.name,
    'tariff_type', v_tariff.tariff_type,
    'base_price', v_tariff.price,
    'currency', v_tariff.currency,
    'min_duration_minutes', v_tariff.min_duration_minutes,
    'rounding_step_minutes', v_tariff.rounding_step_minutes,
    'captured_at', now()
  );

  IF v_tariff.tariff_type = 'fixed' THEN
    v_calculated := v_tariff.price;
    v_segments := jsonb_build_array(jsonb_build_object(
      'time_start', v_ts,
      'time_end', v_te,
      'minutes', _hhmm_to_minutes(v_te) - _hhmm_to_minutes(v_ts),
      'rate', v_tariff.price,
      'amount', v_tariff.price,
      'rule_id', NULL,
      'is_preferential', false
    ));
    v_breakdown := v_segments;
  ELSE
    v_raw_minutes := _hhmm_to_minutes(v_te) - _hhmm_to_minutes(v_ts);
    v_boundaries := ARRAY[_hhmm_to_minutes(v_ts), _hhmm_to_minutes(v_te)];

    FOR v_rule IN
      SELECT r.*
      FROM rental_tariff_rules r
      WHERE r.organization_id = p_org_id
        AND r.tariff_id = p_tariff_id
        AND _tariff_rule_applies(r, p_rental_date, v_ts, v_te)
    LOOP
      v_boundaries := v_boundaries || _hhmm_to_minutes(normalize_hhmm(v_rule.time_start));
      v_boundaries := v_boundaries || _hhmm_to_minutes(normalize_hhmm(v_rule.time_end));
    END LOOP;

    SELECT array_agg(DISTINCT b ORDER BY b)
    INTO v_boundaries
    FROM unnest(v_boundaries) AS b
    WHERE b >= _hhmm_to_minutes(v_ts) AND b <= _hhmm_to_minutes(v_te);

    FOR v_i IN 1 .. COALESCE(array_length(v_boundaries, 1), 0) - 1 LOOP
      v_seg_start := v_boundaries[v_i];
      v_seg_end := v_boundaries[v_i + 1];
      IF v_seg_end <= v_seg_start THEN
        CONTINUE;
      END IF;

      v_best_found := false;
      FOR v_rule IN
        SELECT r.*
        FROM rental_tariff_rules r
        WHERE r.organization_id = p_org_id
          AND r.tariff_id = p_tariff_id
          AND _tariff_rule_applies(
            r,
            p_rental_date,
            to_char((v_seg_start / 60)::int, 'FM00') || ':' || to_char(v_seg_start % 60, 'FM00'),
            to_char((v_seg_end / 60)::int, 'FM00') || ':' || to_char(v_seg_end % 60, 'FM00')
          )
        ORDER BY r.priority DESC, r.created_at, r.id
      LOOP
        v_best_rule := v_rule;
        v_best_found := true;
        EXIT;
      END LOOP;

      v_rate := CASE WHEN v_best_found THEN v_best_rule.price_override ELSE v_tariff.price END;
      v_seg_minutes := v_seg_end - v_seg_start;
      v_seg_amount := round((v_rate * v_seg_minutes / 60.0)::numeric, 2);
      v_calculated := v_calculated + v_seg_amount;

      v_segments := v_segments || jsonb_build_array(jsonb_build_object(
        'time_start', to_char((v_seg_start / 60)::int, 'FM00') || ':' || to_char(v_seg_start % 60, 'FM00'),
        'time_end', to_char((v_seg_end / 60)::int, 'FM00') || ':' || to_char(v_seg_end % 60, 'FM00'),
        'minutes', v_seg_minutes,
        'rate', v_rate,
        'amount', v_seg_amount,
        'rule_id', CASE WHEN v_best_found THEN v_best_rule.id ELSE NULL END,
        'is_preferential', v_best_found
      ));
    END LOOP;

    v_billable_minutes := _round_rental_minutes(
      v_raw_minutes,
      v_tariff.min_duration_minutes,
      v_tariff.rounding_step_minutes
    );

    IF v_raw_minutes > 0 AND v_billable_minutes > v_raw_minutes THEN
      v_calculated := round(v_calculated * v_billable_minutes::numeric / v_raw_minutes::numeric, 2);
    END IF;

    v_breakdown := jsonb_build_array(jsonb_build_object(
      'kind', 'duration',
      'raw_minutes', v_raw_minutes,
      'billable_minutes', v_billable_minutes,
      'min_duration_minutes', v_tariff.min_duration_minutes,
      'rounding_step_minutes', v_tariff.rounding_step_minutes
    )) || v_segments;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'calculated_amount', v_calculated,
    'segments', v_segments,
    'breakdown', v_breakdown,
    'tariff_snapshot', v_snapshot,
    'tariff_type', v_tariff.tariff_type,
    'currency', v_tariff.currency
  );
END;
$$;

CREATE OR REPLACE FUNCTION _generate_series_occurrence_dates(
  p_valid_from date,
  p_valid_to date,
  p_patterns jsonb
)
RETURNS TABLE (
  occurrence_date date,
  time_start text,
  time_end text,
  pattern_id uuid
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_pattern jsonb;
  v_date date;
  v_dow integer;
  v_days int[];
  v_pid uuid;
BEGIN
  IF p_valid_from IS NULL OR p_valid_to IS NULL OR p_valid_to < p_valid_from THEN
    RETURN;
  END IF;

  IF p_patterns IS NULL OR jsonb_typeof(p_patterns) <> 'array' OR jsonb_array_length(p_patterns) = 0 THEN
    RETURN;
  END IF;

  FOR v_date IN
    SELECT gs::date
    FROM generate_series(p_valid_from, p_valid_to, interval '1 day') AS gs
  LOOP
    v_dow := EXTRACT(ISODOW FROM v_date)::integer;

    FOR v_pattern IN SELECT value FROM jsonb_array_elements(p_patterns) LOOP
      v_pid := NULLIF(v_pattern ->> 'pattern_id', '')::uuid;

      SELECT COALESCE(array_agg(value::int), '{}')
      INTO v_days
      FROM jsonb_array_elements_text(v_pattern -> 'days_of_week') AS t(value);

      IF v_days IS NULL OR cardinality(v_days) = 0 OR NOT (v_dow = ANY (v_days)) THEN
        CONTINUE;
      END IF;

      occurrence_date := v_date;
      time_start := normalize_hhmm(v_pattern ->> 'time_start');
      time_end := normalize_hhmm(v_pattern ->> 'time_end');
      pattern_id := v_pid;
      RETURN NEXT;
    END LOOP;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION _rental_invoice_paid_total(p_invoice_id uuid, p_org_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT sum(rip.amount)
    FROM rental_invoice_payments rip
    WHERE rip.invoice_id = p_invoice_id
      AND rip.organization_id = p_org_id
  ), 0) + COALESCE((
    SELECT sum(raa.amount)
    FROM rental_advance_allocations raa
    JOIN rental_invoices ri ON ri.id = raa.invoice_id AND ri.organization_id = raa.organization_id
    WHERE raa.invoice_id = p_invoice_id
      AND raa.organization_id = p_org_id
      AND raa.cancelled_at IS NULL
  ), 0) + COALESCE((
    SELECT sum(rdm.amount)
    FROM rental_deposit_movements rdm
    WHERE rdm.invoice_id = p_invoice_id
      AND rdm.organization_id = p_org_id
      AND rdm.movement_type = 'apply_to_invoice'
  ), 0);
$$;

CREATE OR REPLACE FUNCTION _rental_invoice_status(
  p_total numeric,
  p_paid numeric,
  p_due_date date,
  p_current_status text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_current_status = 'cancelled' THEN
    RETURN 'cancelled';
  END IF;

  IF p_current_status = 'draft' THEN
    RETURN 'draft';
  END IF;

  IF COALESCE(p_paid, 0) <= 0 THEN
    IF p_due_date IS NOT NULL AND p_due_date < current_date THEN
      RETURN 'overdue';
    END IF;
    RETURN 'invoiced';
  END IF;

  IF COALESCE(p_paid, 0) >= COALESCE(p_total, 0) AND COALESCE(p_total, 0) > 0 THEN
    RETURN 'paid';
  END IF;

  IF p_due_date IS NOT NULL AND p_due_date < current_date THEN
    RETURN 'overdue';
  END IF;

  RETURN 'partially_paid';
END;
$$;

CREATE OR REPLACE FUNCTION _rental_is_in_active_invoice(p_rental_id uuid, p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM rental_invoice_lines ril
    JOIN rental_invoices ri
      ON ri.id = ril.invoice_id
     AND ri.organization_id = ril.organization_id
    WHERE ril.rental_id = p_rental_id
      AND ril.organization_id = p_org_id
      AND ri.status <> 'cancelled'
  );
$$;

CREATE OR REPLACE FUNCTION _validate_tariff_rules_no_ambiguous_overlap(p_tariff_id uuid, p_org_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_a rental_tariff_rules%ROWTYPE;
  v_b rental_tariff_rules%ROWTYPE;
  v_shared int[];
  v_d int;
BEGIN
  FOR v_a IN
    SELECT * FROM rental_tariff_rules r
    WHERE r.tariff_id = p_tariff_id AND r.organization_id = p_org_id
  LOOP
    FOR v_b IN
      SELECT * FROM rental_tariff_rules r
      WHERE r.tariff_id = p_tariff_id
        AND r.organization_id = p_org_id
        AND r.id <> v_a.id
        AND r.priority = v_a.priority
    LOOP
      v_shared := ARRAY(
        SELECT unnest(v_a.days_of_week)
        INTERSECT
        SELECT unnest(v_b.days_of_week)
      );

      IF cardinality(v_shared) = 0 THEN
        CONTINUE;
      END IF;

      IF NOT (
        (v_a.valid_to IS NOT NULL AND v_b.valid_from IS NOT NULL AND v_a.valid_to < v_b.valid_from)
        OR (v_b.valid_to IS NOT NULL AND v_a.valid_from IS NOT NULL AND v_b.valid_to < v_a.valid_from)
      ) THEN
        IF schedule_time_ranges_overlap(v_a.time_start, v_a.time_end, v_b.time_start, v_b.time_end) THEN
          RETURN 'rental.tariff.ruleAmbiguousOverlap';
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION _rental_payment_status(p_fixed_amount numeric, p_paid_amount numeric)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN COALESCE(p_paid_amount, 0) <= 0 THEN 'unpaid'
    WHEN COALESCE(p_fixed_amount, 0) > 0 AND COALESCE(p_paid_amount, 0) > COALESCE(p_fixed_amount, 0) THEN 'overpaid'
    WHEN COALESCE(p_fixed_amount, 0) > 0 AND COALESCE(p_paid_amount, 0) >= COALESCE(p_fixed_amount, 0) THEN 'paid'
    WHEN COALESCE(p_fixed_amount, 0) <= 0 AND COALESCE(p_paid_amount, 0) > 0 THEN 'overpaid'
    ELSE 'partial'
  END;
$$;

-- =============================================================================
-- 3. Tariff RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION list_rental_tariffs(p_status text DEFAULT NULL, p_location_id uuid DEFAULT NULL)
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
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'tariff_type', t.tariff_type,
    'location_id', t.location_id,
    'price', CASE WHEN can_read_financial() THEN t.price ELSE NULL END,
    'currency', CASE WHEN can_read_financial() THEN t.currency ELSE NULL END,
    'min_duration_minutes', t.min_duration_minutes,
    'rounding_step_minutes', t.rounding_step_minutes,
    'valid_from', t.valid_from,
    'valid_to', t.valid_to,
    'status', t.status,
    'rules_count', (
      SELECT count(*) FROM rental_tariff_rules r
      WHERE r.tariff_id = t.id AND r.organization_id = v_org_id
    )
  ) ORDER BY t.name), '[]'::jsonb)
  INTO v_rows
  FROM rental_tariffs t
  WHERE t.organization_id = v_org_id
    AND (p_status IS NULL OR t.status = p_status)
    AND (p_location_id IS NULL OR t.location_id IS NULL OR t.location_id = p_location_id);

  RETURN jsonb_build_object('success', true, 'tariffs', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION upsert_rental_tariff(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_tariff_id uuid := NULLIF(p_payload ->> 'tariff_id', '')::uuid;
  v_name text := NULLIF(trim(p_payload ->> 'name'), '');
  v_type text := COALESCE(NULLIF(p_payload ->> 'tariff_type', ''), 'hourly');
  v_status text := COALESCE(NULLIF(p_payload ->> 'status', ''), 'active');
  v_location_id uuid := NULLIF(p_payload ->> 'location_id', '')::uuid;
  v_price numeric := COALESCE((p_payload ->> 'price')::numeric, 0);
  v_rule jsonb;
  v_rule_id uuid;
  v_overlap text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_name IS NULL OR v_type NOT IN ('hourly', 'fixed') OR v_status NOT IN ('active', 'archived') THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.fieldsInvalid');
  END IF;

  IF v_price < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.priceInvalid');
  END IF;

  IF v_location_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.id = v_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF v_tariff_id IS NULL THEN
    INSERT INTO rental_tariffs (
      organization_id, name, tariff_type, location_id, price, currency,
      min_duration_minutes, rounding_step_minutes, valid_from, valid_to, status
    )
    VALUES (
      v_org_id,
      v_name,
      v_type,
      v_location_id,
      v_price,
      COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB'),
      COALESCE((p_payload ->> 'min_duration_minutes')::int, 0),
      GREATEST(COALESCE((p_payload ->> 'rounding_step_minutes')::int, 1), 1),
      NULLIF(p_payload ->> 'valid_from', '')::date,
      NULLIF(p_payload ->> 'valid_to', '')::date,
      v_status
    )
    RETURNING id INTO v_tariff_id;
  ELSE
    UPDATE rental_tariffs
    SET
      name = v_name,
      tariff_type = v_type,
      location_id = v_location_id,
      price = v_price,
      currency = COALESCE(NULLIF(p_payload ->> 'currency', ''), currency),
      min_duration_minutes = COALESCE((p_payload ->> 'min_duration_minutes')::int, min_duration_minutes),
      rounding_step_minutes = GREATEST(COALESCE((p_payload ->> 'rounding_step_minutes')::int, rounding_step_minutes), 1),
      valid_from = CASE WHEN p_payload ? 'valid_from' THEN NULLIF(p_payload ->> 'valid_from', '')::date ELSE valid_from END,
      valid_to = CASE WHEN p_payload ? 'valid_to' THEN NULLIF(p_payload ->> 'valid_to', '')::date ELSE valid_to END,
      status = v_status,
      updated_at = now()
    WHERE id = v_tariff_id AND organization_id = v_org_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.tariff.notFound');
    END IF;
  END IF;

  IF p_payload ? 'rules' THEN
    DELETE FROM rental_tariff_rules r
    WHERE r.tariff_id = v_tariff_id AND r.organization_id = v_org_id;

    FOR v_rule IN SELECT value FROM jsonb_array_elements(p_payload -> 'rules') LOOP
      INSERT INTO rental_tariff_rules (
        organization_id, tariff_id, priority, days_of_week, time_start, time_end,
        price_override, valid_from, valid_to
      )
      VALUES (
        v_org_id,
        v_tariff_id,
        COALESCE((v_rule ->> 'priority')::int, 0),
        ARRAY(SELECT value::int FROM jsonb_array_elements_text(v_rule -> 'days_of_week') AS t(value)),
        normalize_hhmm(v_rule ->> 'time_start'),
        normalize_hhmm(v_rule ->> 'time_end'),
        COALESCE((v_rule ->> 'price_override')::numeric, v_price),
        NULLIF(v_rule ->> 'valid_from', '')::date,
        NULLIF(v_rule ->> 'valid_to', '')::date
      );
    END LOOP;
  END IF;

  v_overlap := _validate_tariff_rules_no_ambiguous_overlap(v_tariff_id, v_org_id);
  IF v_overlap IS NOT NULL THEN
    RAISE EXCEPTION '%', v_overlap USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('success', true, 'tariff_id', v_tariff_id);
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- =============================================================================
-- 4. Series RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION preview_rental_series(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_location_id uuid := (p_payload ->> 'location_id')::uuid;
  v_tariff_id uuid := (p_payload ->> 'tariff_id')::uuid;
  v_valid_from date := (p_payload ->> 'valid_from')::date;
  v_valid_to date := (p_payload ->> 'valid_to')::date;
  v_patterns jsonb := COALESCE(p_payload -> 'patterns', '[]'::jsonb);
  v_occ jsonb := '[]'::jsonb;
  v_row record;
  v_pricing jsonb;
  v_conflicts jsonb;
  v_total numeric := 0;
  v_finance boolean;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF v_renter_id IS NULL OR v_location_id IS NULL OR v_tariff_id IS NULL
     OR v_valid_from IS NULL OR v_valid_to IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.fieldsInvalid');
  END IF;

  IF NOT _renter_is_bookable(v_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  v_finance := can_read_financial();

  FOR v_row IN
    SELECT * FROM _generate_series_occurrence_dates(v_valid_from, v_valid_to, v_patterns)
  LOOP
    v_pricing := _calculate_rental_pricing(v_tariff_id, v_org_id, v_row.occurrence_date, v_row.time_start, v_row.time_end);
    IF NOT COALESCE((v_pricing ->> 'success')::boolean, false) THEN
      RETURN v_pricing;
    END IF;

    v_conflicts := preview_rental_conflicts(v_row.occurrence_date, v_row.time_start, v_row.time_end, v_location_id, NULL);

    v_occ := v_occ || jsonb_build_array(jsonb_build_object(
      'occurrence_date', v_row.occurrence_date,
      'time_start', v_row.time_start,
      'time_end', v_row.time_end,
      'pattern_id', v_row.pattern_id,
      'location_id', v_location_id,
      'calculated_amount', CASE WHEN v_finance THEN v_pricing -> 'calculated_amount' ELSE NULL END,
      'currency', CASE WHEN v_finance THEN v_pricing -> 'currency' ELSE NULL END,
      'tariff_type', v_pricing -> 'tariff_type',
      'pricing_breakdown', CASE WHEN v_finance THEN v_pricing -> 'breakdown' ELSE NULL END,
      'conflicts', COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb),
      'has_conflict', jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0
    ));

    IF v_finance THEN
      v_total := v_total + COALESCE((v_pricing ->> 'calculated_amount')::numeric, 0);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'occurrences', v_occ,
    'occurrence_count', jsonb_array_length(v_occ),
    'total_amount', CASE WHEN v_finance THEN v_total ELSE NULL END,
    'has_conflicts', EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_occ) e
      WHERE COALESCE((e.value ->> 'has_conflict')::boolean, false)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION create_rental_series(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_series%ROWTYPE;
  v_series_id uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_contract_id uuid := NULLIF(p_payload ->> 'contract_id', '')::uuid;
  v_location_id uuid := (p_payload ->> 'location_id')::uuid;
  v_tariff_id uuid := (p_payload ->> 'tariff_id')::uuid;
  v_valid_from date := (p_payload ->> 'valid_from')::date;
  v_valid_to date := (p_payload ->> 'valid_to')::date;
  v_patterns jsonb := COALESCE(p_payload -> 'patterns', '[]'::jsonb);
  v_pattern jsonb;
  v_preview jsonb;
  v_occ jsonb;
  v_item jsonb;
  v_rental_id uuid;
  v_pricing jsonb;
  v_created_ids uuid[] := '{}';
  v_tariff_type text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_series rs
    WHERE rs.organization_id = v_org_id AND rs.idempotency_key = v_key;

    IF FOUND THEN
      SELECT COALESCE(array_agg(r.id), '{}')
      INTO v_created_ids
      FROM rentals r
      WHERE r.rental_series_id = v_existing.id AND r.organization_id = v_org_id;

      RETURN jsonb_build_object(
        'success', true,
        'series_id', v_existing.id,
        'rental_ids', to_jsonb(v_created_ids),
        'already_applied', true
      );
    END IF;
  END IF;

  v_preview := preview_rental_series(p_payload);
  IF NOT COALESCE((v_preview ->> 'success')::boolean, false) THEN
    RETURN v_preview;
  END IF;

  IF COALESCE((v_preview ->> 'has_conflicts')::boolean, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'preview', v_preview);
  END IF;

  IF jsonb_array_length(COALESCE(v_preview -> 'occurrences', '[]'::jsonb)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.noOccurrences');
  END IF;

  INSERT INTO rental_series (
    organization_id, renter_id, contract_id, location_id, tariff_id,
    valid_from, valid_to, status, purpose, idempotency_key, created_by
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_contract_id,
    v_location_id,
    v_tariff_id,
    v_valid_from,
    v_valid_to,
    'active',
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    v_key,
    v_member_id
  )
  RETURNING id INTO v_series_id;

  FOR v_pattern IN SELECT value FROM jsonb_array_elements(v_patterns) LOOP
    INSERT INTO rental_series_patterns (organization_id, series_id, days_of_week, time_start, time_end)
    VALUES (
      v_org_id,
      v_series_id,
      ARRAY(SELECT value::int FROM jsonb_array_elements_text(v_pattern -> 'days_of_week') AS t(value)),
      normalize_hhmm(v_pattern ->> 'time_start'),
      normalize_hhmm(v_pattern ->> 'time_end')
    );
  END LOOP;

  v_occ := v_preview -> 'occurrences';
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_occ) LOOP
    PERFORM pg_advisory_xact_lock(
      _rental_location_lock_key(
        v_org_id,
        v_location_id,
        (v_item ->> 'occurrence_date')::date
      )
    );

    IF schedule_location_has_conflict(
      v_org_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end',
      v_location_id
    ) THEN
      RAISE EXCEPTION 'schedule.rental.conflict' USING ERRCODE = 'P0001';
    END IF;

    v_pricing := _calculate_rental_pricing(
      v_tariff_id,
      v_org_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end'
    );

    v_tariff_type := v_pricing ->> 'tariff_type';

    INSERT INTO rentals (
      organization_id, location_id, rental_date, time_start, time_end,
      renter_id, purpose, rental_series_id, tariff_id, tariff_type,
      tariff_snapshot, pricing_breakdown, calculated_amount, adjustment_amount,
      final_amount, fixed_amount, currency, created_by
    )
    VALUES (
      v_org_id,
      v_location_id,
      (v_item ->> 'occurrence_date')::date,
      v_item ->> 'time_start',
      v_item ->> 'time_end',
      v_renter_id,
      NULLIF(trim(p_payload ->> 'purpose'), ''),
      v_series_id,
      v_tariff_id,
      v_tariff_type,
      v_pricing -> 'tariff_snapshot',
      v_pricing -> 'breakdown',
      (v_pricing ->> 'calculated_amount')::numeric,
      0,
      (v_pricing ->> 'calculated_amount')::numeric,
      (v_pricing ->> 'calculated_amount')::numeric,
      v_pricing ->> 'currency',
      v_member_id
    )
    RETURNING id INTO v_rental_id;

    v_created_ids := v_created_ids || v_rental_id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'series_id', v_series_id,
    'rental_ids', to_jsonb(v_created_ids),
    'occurrence_count', array_length(v_created_ids, 1)
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_series_id FROM rental_series WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_series_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'series_id', v_series_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION cancel_rental_series_occurrence(
  p_series_id uuid,
  p_date date,
  p_reason text,
  p_financial_action text DEFAULT 'none',
  p_penalty_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_series rental_series%ROWTYPE;
  v_rental rentals%ROWTYPE;
  v_final numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.cancelReasonRequired');
  END IF;

  IF p_financial_action NOT IN ('none', 'full_penalty', 'partial_penalty', 'manual') THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.financialActionInvalid');
  END IF;

  SELECT * INTO v_series
  FROM rental_series rs
  WHERE rs.id = p_series_id AND rs.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.notFound');
  END IF;

  IF EXISTS (
    SELECT 1 FROM rental_series_exceptions e
    WHERE e.series_id = p_series_id AND e.organization_id = v_org_id AND e.exception_date = p_date
  ) THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.rental_series_id = p_series_id
    AND r.rental_date = p_date
    AND r.booking_status = 'confirmed'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.occurrenceNotFound');
  END IF;

  INSERT INTO rental_series_exceptions (
    organization_id, series_id, exception_date, reason,
    financial_action, penalty_amount, cancelled_by
  )
  VALUES (
    v_org_id, p_series_id, p_date, trim(p_reason),
    p_financial_action,
    CASE
      WHEN p_financial_action = 'full_penalty' THEN _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount)
      WHEN p_financial_action = 'partial_penalty' THEN p_penalty_amount
      ELSE NULL
    END,
    v_member_id
  );

  UPDATE rentals
  SET
    booking_status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = trim(p_reason),
    cancelled_by = v_member_id,
    updated_at = now()
  WHERE id = v_rental.id;

  IF p_financial_action = 'none' THEN
    UPDATE rentals
    SET final_amount = 0, fixed_amount = 0, adjustment_amount = 0, updated_at = now()
    WHERE id = v_rental.id;
  ELSIF p_financial_action = 'full_penalty' THEN
    v_final := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);
    UPDATE rentals
    SET final_amount = v_final, fixed_amount = v_final, updated_at = now()
    WHERE id = v_rental.id;
  ELSIF p_financial_action = 'partial_penalty' THEN
    IF p_penalty_amount IS NULL OR p_penalty_amount <= 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.series.penaltyInvalid');
    END IF;
    UPDATE rentals
    SET final_amount = p_penalty_amount, fixed_amount = p_penalty_amount, updated_at = now()
    WHERE id = v_rental.id;
  END IF;

  RETURN jsonb_build_object('success', true, 'rental_id', v_rental.id, 'series_id', p_series_id);
END;
$$;

CREATE OR REPLACE FUNCTION update_rental_series(
  p_series_id uuid,
  p_payload jsonb,
  p_scope text DEFAULT 'future'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_series rental_series%ROWTYPE;
  v_pivot date := COALESCE((p_payload ->> 'pivot_date')::date, current_date);
  v_new_series_id uuid;
  v_create_result jsonb;
  v_rental rentals%ROWTYPE;
  v_affected int := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF p_scope NOT IN ('single', 'future', 'all') THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.scopeInvalid');
  END IF;

  SELECT * INTO v_series
  FROM rental_series rs
  WHERE rs.id = p_series_id AND rs.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.notFound');
  END IF;

  IF p_scope = 'single' THEN
    SELECT * INTO v_rental
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.rental_series_id = p_series_id
      AND r.rental_date = v_pivot
      AND r.booking_status = 'confirmed'
    FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.series.occurrenceNotFound');
    END IF;

    IF v_rental.rental_date < current_date OR _rental_is_in_active_invoice(v_rental.id, v_org_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.series.occurrenceLocked');
    END IF;

    PERFORM update_rental(
      v_rental.id,
      p_payload || jsonb_build_object('rental_date', v_pivot)
    );
    RETURN jsonb_build_object('success', true, 'series_id', p_series_id, 'rental_id', v_rental.id);
  END IF;

  IF p_scope = 'all' THEN
    UPDATE rental_series
    SET
      valid_from = COALESCE((p_payload ->> 'valid_from')::date, valid_from),
      valid_to = COALESCE((p_payload ->> 'valid_to')::date, valid_to),
      purpose = CASE WHEN p_payload ? 'purpose' THEN NULLIF(trim(p_payload ->> 'purpose'), '') ELSE purpose END,
      tariff_id = COALESCE((p_payload ->> 'tariff_id')::uuid, tariff_id),
      location_id = COALESCE((p_payload ->> 'location_id')::uuid, location_id),
      updated_at = now()
    WHERE id = p_series_id;

    GET DIAGNOSTICS v_affected = ROW_COUNT;
    RETURN jsonb_build_object('success', true, 'series_id', p_series_id, 'updated', v_affected > 0);
  END IF;

  -- future scope: end current series before pivot, create new series from pivot
  IF v_pivot <= v_series.valid_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.pivotInvalid');
  END IF;

  UPDATE rental_series
  SET valid_to = v_pivot - 1, updated_at = now()
  WHERE id = p_series_id;

  UPDATE rentals
  SET booking_status = 'cancelled', cancelled_at = now(), cancelled_reason = 'Series rescheduled', cancelled_by = v_member_id, updated_at = now()
  WHERE organization_id = v_org_id
    AND rental_series_id = p_series_id
    AND rental_date >= v_pivot
    AND booking_status = 'confirmed'
    AND rental_date >= current_date
    AND NOT _rental_is_in_active_invoice(id, v_org_id);

  v_create_result := create_rental_series(
    jsonb_build_object(
      'renter_id', COALESCE((p_payload ->> 'renter_id')::uuid, v_series.renter_id),
      'contract_id', COALESCE(NULLIF(p_payload ->> 'contract_id', ''), v_series.contract_id::text),
      'location_id', COALESCE((p_payload ->> 'location_id')::uuid, v_series.location_id),
      'tariff_id', COALESCE((p_payload ->> 'tariff_id')::uuid, v_series.tariff_id),
      'valid_from', v_pivot,
      'valid_to', COALESCE((p_payload ->> 'valid_to')::date, v_series.valid_to),
      'purpose', COALESCE(p_payload ->> 'purpose', v_series.purpose),
      'patterns', COALESCE(p_payload -> 'patterns', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'days_of_week', to_jsonb(p.days_of_week),
          'time_start', p.time_start,
          'time_end', p.time_end
        )), '[]'::jsonb)
        FROM rental_series_patterns p
        WHERE p.series_id = p_series_id AND p.organization_id = v_org_id
      )),
      'idempotency_key', NULLIF(trim(p_payload ->> 'idempotency_key'), '')
    )
  );

  IF NOT COALESCE((v_create_result ->> 'success')::boolean, false) THEN
    RETURN v_create_result;
  END IF;

  v_new_series_id := (v_create_result ->> 'series_id')::uuid;

  IF v_new_series_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.rescheduleFailed');
  END IF;

  RETURN jsonb_build_object('success', true, 'old_series_id', p_series_id, 'new_series_id', v_new_series_id);
END;
$$;

CREATE OR REPLACE FUNCTION get_rental_series_detail(p_series_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_series rental_series%ROWTYPE;
  v_finance boolean;
  v_patterns jsonb;
  v_occurrences jsonb;
  v_exceptions jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  SELECT * INTO v_series
  FROM rental_series rs
  WHERE rs.id = p_series_id AND rs.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.series.notFound');
  END IF;

  v_finance := can_read_financial();

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', p.id,
    'days_of_week', p.days_of_week,
    'time_start', p.time_start,
    'time_end', p.time_end
  ) ORDER BY p.time_start), '[]'::jsonb)
  INTO v_patterns
  FROM rental_series_patterns p
  WHERE p.series_id = p_series_id AND p.organization_id = v_org_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'rental_id', r.id,
    'rental_date', r.rental_date,
    'time_start', r.time_start,
    'time_end', r.time_end,
    'booking_status', r.booking_status,
    'calculated_amount', CASE WHEN v_finance THEN r.calculated_amount ELSE NULL END,
    'final_amount', CASE WHEN v_finance THEN _rental_effective_amount(r.fixed_amount, r.final_amount) ELSE NULL END,
    'currency', CASE WHEN v_finance THEN r.currency ELSE NULL END,
    'paid_amount', CASE WHEN v_finance THEN _rental_paid_total(r.id, r.organization_id) ELSE NULL END
  ) ORDER BY r.rental_date, r.time_start), '[]'::jsonb)
  INTO v_occurrences
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.rental_series_id = p_series_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'exception_date', e.exception_date,
    'reason', e.reason,
    'financial_action', e.financial_action,
    'penalty_amount', CASE WHEN v_finance THEN e.penalty_amount ELSE NULL END,
    'cancelled_at', e.cancelled_at
  ) ORDER BY e.exception_date), '[]'::jsonb)
  INTO v_exceptions
  FROM rental_series_exceptions e
  WHERE e.series_id = p_series_id AND e.organization_id = v_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'series', jsonb_build_object(
      'id', v_series.id,
      'renter_id', v_series.renter_id,
      'contract_id', v_series.contract_id,
      'location_id', v_series.location_id,
      'tariff_id', v_series.tariff_id,
      'valid_from', v_series.valid_from,
      'valid_to', v_series.valid_to,
      'status', v_series.status,
      'purpose', v_series.purpose
    ),
    'patterns', v_patterns,
    'occurrences', v_occurrences,
    'exceptions', v_exceptions
  );
END;
$$;

-- =============================================================================
-- 5. Invoice / advance / deposit RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION create_rental_invoice(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_invoices%ROWTYPE;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_series_id uuid := NULLIF(p_payload ->> 'series_id', '')::uuid;
  v_period_start date := (p_payload ->> 'period_start')::date;
  v_period_end date := (p_payload ->> 'period_end')::date;
  v_due_date date := COALESCE((p_payload ->> 'due_date')::date, v_period_end + 14);
  v_invoice_id uuid;
  v_rental rentals%ROWTYPE;
  v_total numeric(12, 2) := 0;
  v_currency text := 'RUB';
  v_status text := COALESCE(NULLIF(p_payload ->> 'status', ''), 'invoiced');
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_renter_id IS NULL OR v_period_start IS NULL OR v_period_end IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.fieldsInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_invoices ri
    WHERE ri.organization_id = v_org_id AND ri.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'invoice_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  INSERT INTO rental_invoices (
    organization_id, renter_id, series_id, period_start, period_end,
    due_date, status, currency, total_amount, idempotency_key, created_by
  )
  VALUES (
    v_org_id, v_renter_id, v_series_id, v_period_start, v_period_end,
    v_due_date, v_status, v_currency, 0, v_key, v_member_id
  )
  RETURNING id INTO v_invoice_id;

  FOR v_rental IN
    SELECT r.*
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = v_renter_id
      AND r.rental_date >= v_period_start
      AND r.rental_date <= v_period_end
      AND r.booking_status = 'confirmed'
      AND (v_series_id IS NULL OR r.rental_series_id = v_series_id)
      AND NOT _rental_is_in_active_invoice(r.id, v_org_id)
    ORDER BY r.rental_date, r.time_start
  LOOP
    v_currency := v_rental.currency;
    v_total := v_total + _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);

    INSERT INTO rental_invoice_lines (
      organization_id, invoice_id, rental_id, line_type, description, amount
    )
    VALUES (
      v_org_id,
      v_invoice_id,
      v_rental.id,
      'booking',
      'Rental ' || v_rental.rental_date::text || ' ' || v_rental.time_start || '-' || v_rental.time_end,
      _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount)
    );
  END LOOP;

  UPDATE rental_invoices
  SET total_amount = v_total, currency = v_currency, updated_at = now()
  WHERE id = v_invoice_id;

  RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'total_amount', v_total);
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_invoice_id FROM rental_invoices WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_invoice_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'invoice_id', v_invoice_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION record_rental_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_invoice rental_invoices%ROWTYPE;
  v_existing rental_invoice_payments%ROWTYPE;
  v_payment_id uuid;
  v_paid numeric;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentMethodInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_invoice_payments rip
    WHERE rip.organization_id = v_org_id AND rip.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'payment_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  SELECT * INTO v_invoice
  FROM rental_invoices ri
  WHERE ri.id = p_invoice_id AND ri.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
  END IF;

  IF v_invoice.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.cancelled');
  END IF;

  INSERT INTO rental_invoice_payments (
    organization_id, invoice_id, amount, currency, method, idempotency_key, created_by
  )
  VALUES (
    v_org_id, p_invoice_id, p_amount, v_invoice.currency, p_method, v_key, v_member_id
  )
  RETURNING id INTO v_payment_id;

  v_paid := _rental_invoice_paid_total(p_invoice_id, v_org_id);
  v_status := _rental_invoice_status(v_invoice.total_amount, v_paid, v_invoice.due_date, v_invoice.status);

  UPDATE rental_invoices
  SET status = v_status, updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'paid_amount', v_paid,
    'status', v_status
  );
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_payment_id FROM rental_invoice_payments WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_payment_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION record_rental_advance(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_advances%ROWTYPE;
  v_advance_id uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_amount numeric := (p_payload ->> 'amount')::numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_renter_id IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.fieldsInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_advances ra
    WHERE ra.organization_id = v_org_id AND ra.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'advance_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  INSERT INTO rental_advances (
    organization_id, renter_id, amount, currency, method, idempotency_key, created_by
  )
  VALUES (
    v_org_id,
    v_renter_id,
    v_amount,
    COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB'),
    COALESCE(NULLIF(p_payload ->> 'method', ''), 'cash'),
    v_key,
    v_member_id
  )
  RETURNING id INTO v_advance_id;

  RETURN jsonb_build_object('success', true, 'advance_id', v_advance_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_advance_id FROM rental_advances WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_advance_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'advance_id', v_advance_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION allocate_rental_advance(
  p_advance_id uuid,
  p_invoice_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_advance rental_advances%ROWTYPE;
  v_invoice rental_invoices%ROWTYPE;
  v_allocation_id uuid;
  v_paid numeric;
  v_status text;
  v_available numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.paymentAmountInvalid');
  END IF;

  SELECT * INTO v_advance
  FROM rental_advances ra
  WHERE ra.id = p_advance_id AND ra.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.notFound');
  END IF;

  SELECT * INTO v_invoice
  FROM rental_invoices ri
  WHERE ri.id = p_invoice_id AND ri.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.invoice.notFound');
  END IF;

  IF v_advance.renter_id <> v_invoice.renter_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.renterMismatch');
  END IF;

  IF v_advance.currency <> v_invoice.currency THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.currencyMismatch');
  END IF;

  v_available := v_advance.amount - v_advance.allocated_amount;
  IF p_amount > v_available THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.insufficient');
  END IF;

  INSERT INTO rental_advance_allocations (
    organization_id, advance_id, invoice_id, amount, allocated_by
  )
  VALUES (v_org_id, p_advance_id, p_invoice_id, p_amount, v_member_id)
  RETURNING id INTO v_allocation_id;

  UPDATE rental_advances
  SET allocated_amount = allocated_amount + p_amount
  WHERE id = p_advance_id;

  v_paid := _rental_invoice_paid_total(p_invoice_id, v_org_id);
  v_status := _rental_invoice_status(v_invoice.total_amount, v_paid, v_invoice.due_date, v_invoice.status);

  UPDATE rental_invoices
  SET status = v_status, updated_at = now()
  WHERE id = p_invoice_id;

  RETURN jsonb_build_object(
    'success', true,
    'allocation_id', v_allocation_id,
    'paid_amount', v_paid,
    'status', v_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION cancel_rental_advance_allocation(p_allocation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_row rental_advance_allocations%ROWTYPE;
  v_invoice rental_invoices%ROWTYPE;
  v_paid numeric;
  v_status text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  SELECT * INTO v_row
  FROM rental_advance_allocations raa
  WHERE raa.id = p_allocation_id AND raa.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.advance.allocationNotFound');
  END IF;

  IF v_row.cancelled_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true);
  END IF;

  UPDATE rental_advance_allocations
  SET cancelled_at = now()
  WHERE id = p_allocation_id;

  UPDATE rental_advances
  SET allocated_amount = allocated_amount - v_row.amount
  WHERE id = v_row.advance_id AND organization_id = v_org_id;

  SELECT * INTO v_invoice FROM rental_invoices WHERE id = v_row.invoice_id AND organization_id = v_org_id;
  v_paid := _rental_invoice_paid_total(v_row.invoice_id, v_org_id);
  v_status := _rental_invoice_status(v_invoice.total_amount, v_paid, v_invoice.due_date, v_invoice.status);

  UPDATE rental_invoices SET status = v_status, updated_at = now() WHERE id = v_row.invoice_id;

  RETURN jsonb_build_object('success', true, 'allocation_id', p_allocation_id, 'status', v_status);
END;
$$;

CREATE OR REPLACE FUNCTION record_rental_deposit_movement(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rental_deposit_movements%ROWTYPE;
  v_deposit_id uuid := NULLIF(p_payload ->> 'deposit_id', '')::uuid;
  v_renter_id uuid := (p_payload ->> 'renter_id')::uuid;
  v_contract_id uuid := NULLIF(p_payload ->> 'contract_id', '')::uuid;
  v_movement_type text := NULLIF(trim(p_payload ->> 'movement_type'), '');
  v_amount numeric := (p_payload ->> 'amount')::numeric;
  v_invoice_id uuid := NULLIF(p_payload ->> 'invoice_id', '')::uuid;
  v_movement_id uuid;
  v_delta numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF v_movement_type NOT IN ('receive', 'hold', 'return', 'apply_to_invoice')
     OR v_amount IS NULL OR v_amount <= 0
     OR NULLIF(trim(p_payload ->> 'reason'), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.deposit.fieldsInvalid');
  END IF;

  IF v_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rental_deposit_movements rdm
    WHERE rdm.organization_id = v_org_id AND rdm.idempotency_key = v_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'movement_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  IF v_deposit_id IS NULL THEN
    IF v_renter_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.deposit.fieldsInvalid');
    END IF;

    INSERT INTO rental_deposits (
      organization_id, renter_id, contract_id, required_amount, balance, currency
    )
    VALUES (
      v_org_id,
      v_renter_id,
      v_contract_id,
      COALESCE((p_payload ->> 'required_amount')::numeric, 0),
      0,
      COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB')
    )
    RETURNING id INTO v_deposit_id;
  ELSE
    PERFORM 1 FROM rental_deposits rd WHERE rd.id = v_deposit_id AND rd.organization_id = v_org_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'rental.deposit.notFound');
    END IF;
  END IF;

  v_delta := CASE v_movement_type
    WHEN 'receive' THEN v_amount
    WHEN 'return' THEN -v_amount
    WHEN 'hold' THEN -v_amount
    WHEN 'apply_to_invoice' THEN -v_amount
  END;

  IF v_movement_type = 'apply_to_invoice' AND v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.deposit.invoiceRequired');
  END IF;

  INSERT INTO rental_deposit_movements (
    organization_id, deposit_id, movement_type, amount, reason, invoice_id, idempotency_key, created_by
  )
  VALUES (
    v_org_id, v_deposit_id, v_movement_type, v_amount,
    trim(p_payload ->> 'reason'), v_invoice_id, v_key, v_member_id
  )
  RETURNING id INTO v_movement_id;

  UPDATE rental_deposits
  SET balance = balance + v_delta, updated_at = now()
  WHERE id = v_deposit_id AND organization_id = v_org_id;

  IF v_movement_type = 'apply_to_invoice' THEN
    PERFORM record_rental_invoice_payment(v_invoice_id, v_amount, 'transfer', CASE WHEN v_key IS NOT NULL THEN v_key || ':deposit' END);
  END IF;

  RETURN jsonb_build_object('success', true, 'movement_id', v_movement_id, 'deposit_id', v_deposit_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_key IS NOT NULL THEN
      SELECT id INTO v_movement_id FROM rental_deposit_movements WHERE organization_id = v_org_id AND idempotency_key = v_key;
      IF v_movement_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'movement_id', v_movement_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
END;
$$;

CREATE OR REPLACE FUNCTION apply_rental_pricing_adjustment(
  p_rental_id uuid,
  p_new_amount numeric,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_rental rentals%ROWTYPE;
  v_old numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() OR NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  IF NULLIF(trim(p_reason), '') IS NULL OR p_new_amount IS NULL OR p_new_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.pricing.fieldsInvalid');
  END IF;

  SELECT * INTO v_rental
  FROM rentals r
  WHERE r.id = p_rental_id AND r.organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  IF _rental_is_in_active_invoice(p_rental_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'rental.pricing.invoiced');
  END IF;

  v_old := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);

  INSERT INTO rental_pricing_adjustments (
    organization_id, rental_id, old_amount, new_amount, reason, created_by
  )
  VALUES (v_org_id, p_rental_id, v_old, p_new_amount, trim(p_reason), v_member_id);

  UPDATE rentals
  SET
    adjustment_amount = p_new_amount - COALESCE(calculated_amount, v_old),
    final_amount = p_new_amount,
    fixed_amount = p_new_amount,
    updated_at = now()
  WHERE id = p_rental_id;

  RETURN jsonb_build_object('success', true, 'rental_id', p_rental_id, 'old_amount', v_old, 'new_amount', p_new_amount);
END;
$$;

CREATE OR REPLACE FUNCTION list_renter_rental_invoices(p_renter_id uuid)
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
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', ri.id,
    'series_id', ri.series_id,
    'period_start', ri.period_start,
    'period_end', ri.period_end,
    'due_date', ri.due_date,
    'status', ri.status,
    'currency', ri.currency,
    'total_amount', ri.total_amount,
    'paid_amount', _rental_invoice_paid_total(ri.id, ri.organization_id),
    'outstanding', GREATEST(ri.total_amount - _rental_invoice_paid_total(ri.id, ri.organization_id), 0)
  ) ORDER BY ri.period_start DESC), '[]'::jsonb)
  INTO v_rows
  FROM rental_invoices ri
  WHERE ri.organization_id = v_org_id AND ri.renter_id = p_renter_id;

  RETURN jsonb_build_object('success', true, 'invoices', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION get_renter_rental_finance(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_invoice_debt numeric := 0;
  v_rental_debt numeric := 0;
  v_advances numeric := 0;
  v_deposits numeric := 0;
  v_overdue numeric := 0;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  SELECT COALESCE(sum(GREATEST(ri.total_amount - _rental_invoice_paid_total(ri.id, ri.organization_id), 0)), 0)
  INTO v_invoice_debt
  FROM rental_invoices ri
  WHERE ri.organization_id = v_org_id
    AND ri.renter_id = p_renter_id
    AND ri.status <> 'cancelled';

  SELECT COALESCE(sum(GREATEST(_rental_effective_amount(r.fixed_amount, r.final_amount) - _rental_paid_total(r.id, r.organization_id), 0)), 0)
  INTO v_rental_debt
  FROM rentals r
  WHERE r.organization_id = v_org_id
    AND r.renter_id = p_renter_id
    AND r.booking_status = 'confirmed'
    AND NOT _rental_is_in_active_invoice(r.id, v_org_id);

  SELECT COALESCE(sum(ra.amount - ra.allocated_amount), 0)
  INTO v_advances
  FROM rental_advances ra
  WHERE ra.organization_id = v_org_id AND ra.renter_id = p_renter_id;

  SELECT COALESCE(sum(rd.balance), 0)
  INTO v_deposits
  FROM rental_deposits rd
  WHERE rd.organization_id = v_org_id AND rd.renter_id = p_renter_id;

  SELECT COALESCE(sum(GREATEST(ri.total_amount - _rental_invoice_paid_total(ri.id, ri.organization_id), 0)), 0)
  INTO v_overdue
  FROM rental_invoices ri
  WHERE ri.organization_id = v_org_id
    AND ri.renter_id = p_renter_id
    AND ri.status IN ('invoiced', 'partially_paid', 'overdue')
    AND ri.due_date < current_date;

  RETURN jsonb_build_object(
    'success', true,
    'finance', jsonb_build_object(
      'invoice_debt', v_invoice_debt,
      'uninvoiced_rental_debt', v_rental_debt,
      'total_debt', v_invoice_debt + v_rental_debt,
      'advance_balance', v_advances,
      'deposit_balance', v_deposits,
      'overdue_amount', v_overdue
    )
  );
END;
$$;

-- =============================================================================
-- 6. Patch existing rental RPCs
-- =============================================================================

CREATE OR REPLACE FUNCTION create_rental(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_idempotency_key text := NULLIF(trim(p_payload ->> 'idempotency_key'), '');
  v_existing rentals%ROWTYPE;
  v_rental_id uuid;
  v_date date;
  v_time_start text;
  v_time_end text;
  v_location_id uuid;
  v_renter_id uuid;
  v_tariff_id uuid := NULLIF(p_payload ->> 'tariff_id', '')::uuid;
  v_fixed_amount numeric;
  v_currency text;
  v_conflicts jsonb;
  v_conflict jsonb;
  v_pricing jsonb;
  v_tariff_type text;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT member_can_manage_rentals() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.forbidden');
  END IF;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM rentals r
    WHERE r.organization_id = v_org_id AND r.idempotency_key = v_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'rental_id', v_existing.id, 'already_applied', true);
    END IF;
  END IF;

  v_date := (p_payload ->> 'rental_date')::date;
  v_time_start := normalize_hhmm(p_payload ->> 'time_start');
  v_time_end := normalize_hhmm(p_payload ->> 'time_end');
  v_location_id := (p_payload ->> 'location_id')::uuid;
  v_renter_id := (p_payload ->> 'renter_id')::uuid;
  v_fixed_amount := COALESCE((p_payload ->> 'fixed_amount')::numeric, 0);
  v_currency := COALESCE(NULLIF(p_payload ->> 'currency', ''), 'RUB');

  IF v_date IS NULL OR v_location_id IS NULL OR v_renter_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.fieldsInvalid');
  END IF;

  IF _hhmm_to_minutes(v_time_end) <= _hhmm_to_minutes(v_time_start) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.timeRangeInvalid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.id = v_location_id AND l.organization_id = v_org_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.locationInvalid');
  END IF;

  IF NOT _renter_is_bookable(v_renter_id, v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.renterInvalid');
  END IF;

  IF v_tariff_id IS NOT NULL THEN
    v_pricing := _calculate_rental_pricing(v_tariff_id, v_org_id, v_date, v_time_start, v_time_end);
    IF NOT COALESCE((v_pricing ->> 'success')::boolean, false) THEN
      RETURN v_pricing;
    END IF;
    v_fixed_amount := (v_pricing ->> 'calculated_amount')::numeric;
    v_currency := v_pricing ->> 'currency';
    v_tariff_type := v_pricing ->> 'tariff_type';
  END IF;

  IF v_fixed_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.amountInvalid');
  END IF;

  IF v_fixed_amount > 0 AND NOT can_read_financial() AND v_tariff_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.financeForbidden');
  END IF;

  v_conflicts := preview_rental_conflicts(v_date, v_time_start, v_time_end, v_location_id, NULL);
  IF NOT COALESCE((v_conflicts ->> 'success')::boolean, false) THEN
    RETURN v_conflicts;
  END IF;

  IF jsonb_array_length(COALESCE(v_conflicts -> 'conflicts', '[]'::jsonb)) > 0 THEN
    SELECT value INTO v_conflict FROM jsonb_array_elements(v_conflicts -> 'conflicts') LIMIT 1;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict', 'conflict', v_conflict);
  END IF;

  PERFORM pg_advisory_xact_lock(_rental_location_lock_key(v_org_id, v_location_id, v_date));

  IF schedule_location_has_conflict(v_org_id, v_date, v_time_start, v_time_end, v_location_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.conflict');
  END IF;

  INSERT INTO rentals (
    organization_id, location_id, rental_date, time_start, time_end,
    renter_id, purpose, internal_comment, fixed_amount, currency,
    tariff_id, tariff_type, tariff_snapshot, pricing_breakdown,
    calculated_amount, adjustment_amount, final_amount,
    idempotency_key, created_by
  )
  VALUES (
    v_org_id, v_location_id, v_date, v_time_start, v_time_end,
    v_renter_id,
    NULLIF(trim(p_payload ->> 'purpose'), ''),
    NULLIF(trim(p_payload ->> 'internal_comment'), ''),
    v_fixed_amount, v_currency,
    v_tariff_id,
    v_tariff_type,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_pricing -> 'tariff_snapshot' ELSE NULL END,
    CASE WHEN v_tariff_id IS NOT NULL THEN v_pricing -> 'breakdown' ELSE NULL END,
    CASE WHEN v_tariff_id IS NOT NULL THEN (v_pricing ->> 'calculated_amount')::numeric ELSE NULL END,
    0,
    CASE WHEN v_tariff_id IS NOT NULL THEN (v_pricing ->> 'calculated_amount')::numeric ELSE NULL END,
    v_idempotency_key, v_member_id
  )
  RETURNING id INTO v_rental_id;

  IF COALESCE((p_payload ->> 'initial_payment')::numeric, 0) > 0 THEN
    IF NOT can_read_financial() THEN
      RAISE EXCEPTION 'schedule.rental.financeForbidden' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO rental_payments (
      organization_id, rental_id, amount, currency, method, method_comment, idempotency_key, created_by
    )
    VALUES (
      v_org_id, v_rental_id, (p_payload ->> 'initial_payment')::numeric, v_currency,
      COALESCE(NULLIF(p_payload ->> 'payment_method', ''), 'cash'),
      NULLIF(trim(p_payload ->> 'payment_comment'), ''),
      CASE WHEN v_idempotency_key IS NOT NULL THEN v_idempotency_key || ':payment' END,
      v_member_id
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id);
EXCEPTION
  WHEN unique_violation THEN
    IF v_idempotency_key IS NOT NULL THEN
      SELECT id INTO v_rental_id FROM rentals WHERE organization_id = v_org_id AND idempotency_key = v_idempotency_key;
      IF v_rental_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'rental_id', v_rental_id, 'already_applied', true);
      END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.duplicate');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

CREATE OR REPLACE FUNCTION get_rentals_for_schedule_week(
  p_week_start date,
  p_week_end date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rows jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN '[]'::jsonb;
  END IF;

  v_sensitive := member_can_see_rental_sensitive();

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.rental_date, x.time_start), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      r.id AS rental_id,
      r.rental_date,
      r.time_start,
      r.time_end,
      r.location_id,
      r.rental_series_id,
      r.booking_status,
      CASE WHEN v_sensitive THEN r.purpose ELSE NULL END AS purpose,
      CASE WHEN v_sensitive THEN ren.display_name ELSE NULL END AS renter_name,
      CASE WHEN v_sensitive THEN _rental_effective_amount(r.fixed_amount, r.final_amount) ELSE NULL END AS fixed_amount,
      CASE WHEN v_sensitive THEN r.currency ELSE NULL END AS currency,
      CASE WHEN v_sensitive THEN _rental_paid_total(r.id, r.organization_id) ELSE NULL END AS paid_amount,
      CASE WHEN v_sensitive THEN _rental_payment_status(
        _rental_effective_amount(r.fixed_amount, r.final_amount),
        _rental_paid_total(r.id, r.organization_id)
      ) ELSE NULL END AS payment_status
    FROM rentals r
    JOIN renters ren ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
    WHERE r.organization_id = v_org_id
      AND r.rental_date >= p_week_start
      AND r.rental_date <= p_week_end
  ) x;

  RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION get_rental_detail(p_rental_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_sensitive boolean;
  v_rental rentals%ROWTYPE;
  v_renter renters%ROWTYPE;
  v_paid numeric;
  v_effective numeric;
  v_payments jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT can_read_operational() AND current_member_role() <> 'teacher' THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  SELECT * INTO v_rental FROM rentals r WHERE r.id = p_rental_id AND r.organization_id = v_org_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.rental.notFound');
  END IF;

  SELECT * INTO v_renter FROM renters ren WHERE ren.id = v_rental.renter_id AND ren.organization_id = v_org_id;
  v_sensitive := member_can_see_rental_sensitive();
  v_paid := _rental_paid_total(p_rental_id, v_org_id);
  v_effective := _rental_effective_amount(v_rental.fixed_amount, v_rental.final_amount);

  IF v_sensitive AND can_read_financial() THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', rp.id,
      'amount', rp.amount,
      'currency', rp.currency,
      'method', rp.method,
      'method_comment', rp.method_comment,
      'created_at', rp.created_at
    ) ORDER BY rp.created_at), '[]'::jsonb)
    INTO v_payments
    FROM rental_payments rp
    WHERE rp.rental_id = p_rental_id AND rp.organization_id = v_org_id;
  ELSE
    v_payments := '[]'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'rental', jsonb_build_object(
      'id', v_rental.id,
      'rental_date', v_rental.rental_date,
      'time_start', v_rental.time_start,
      'time_end', v_rental.time_end,
      'location_id', v_rental.location_id,
      'rental_series_id', v_rental.rental_series_id,
      'booking_status', v_rental.booking_status,
      'purpose', CASE WHEN v_sensitive THEN v_rental.purpose ELSE NULL END,
      'internal_comment', CASE WHEN v_sensitive THEN v_rental.internal_comment ELSE NULL END,
      'fixed_amount', CASE WHEN v_sensitive THEN v_effective ELSE NULL END,
      'calculated_amount', CASE WHEN v_sensitive AND can_read_financial() THEN v_rental.calculated_amount ELSE NULL END,
      'currency', CASE WHEN v_sensitive THEN v_rental.currency ELSE NULL END,
      'paid_amount', CASE WHEN v_sensitive THEN v_paid ELSE NULL END,
      'payment_status', CASE WHEN v_sensitive THEN _rental_payment_status(v_effective, v_paid) ELSE NULL END,
      'cancelled_at', v_rental.cancelled_at,
      'cancelled_reason', CASE WHEN v_sensitive THEN v_rental.cancelled_reason ELSE NULL END
    ),
    'renter', jsonb_build_object(
      'id', v_renter.id,
      'display_name', CASE WHEN v_sensitive THEN v_renter.display_name ELSE NULL END,
      'contact_phone', CASE WHEN v_sensitive AND can_read_financial() THEN v_renter.contact_phone ELSE NULL END,
      'contact_email', CASE WHEN v_sensitive AND can_read_financial() THEN v_renter.contact_email ELSE NULL END
    ),
    'payments', v_payments
  );
END;
$$;

-- =============================================================================
-- 7. RLS
-- =============================================================================

ALTER TABLE rental_tariffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_tariff_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_series_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_series_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_advances ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_advance_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_deposit_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_pricing_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY rental_tariffs_select ON rental_tariffs FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_manage_rentals()
  );

CREATE POLICY rental_tariffs_write ON rental_tariffs FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals() AND can_read_financial());

CREATE POLICY rental_tariff_rules_select ON rental_tariff_rules FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_manage_rentals()
  );

CREATE POLICY rental_tariff_rules_write ON rental_tariff_rules FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals() AND can_read_financial());

CREATE POLICY rental_series_select ON rental_series FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_manage_rentals()
  );

CREATE POLICY rental_series_write ON rental_series FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY rental_series_patterns_select ON rental_series_patterns FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_manage_rentals()
  );

CREATE POLICY rental_series_patterns_write ON rental_series_patterns FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY rental_series_exceptions_select ON rental_series_exceptions FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND member_can_manage_rentals()
  );

CREATE POLICY rental_series_exceptions_write ON rental_series_exceptions FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND member_can_manage_rentals())
  WITH CHECK (organization_id = auth_organization_id() AND member_can_manage_rentals());

CREATE POLICY rental_invoices_select ON rental_invoices FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY rental_invoices_write ON rental_invoices FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND can_read_financial());

CREATE POLICY rental_invoice_lines_select ON rental_invoice_lines FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY rental_invoice_lines_write ON rental_invoice_lines FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND can_read_financial());

CREATE POLICY rental_invoice_payments_select ON rental_invoice_payments FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY rental_invoice_payments_write ON rental_invoice_payments FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND can_read_financial());

CREATE POLICY rental_advances_select ON rental_advances FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY rental_advances_write ON rental_advances FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND can_read_financial());

CREATE POLICY rental_advance_allocations_select ON rental_advance_allocations FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY rental_advance_allocations_write ON rental_advance_allocations FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND can_read_financial());

CREATE POLICY rental_deposits_select ON rental_deposits FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY rental_deposits_write ON rental_deposits FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND can_read_financial());

CREATE POLICY rental_deposit_movements_select ON rental_deposit_movements FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY rental_deposit_movements_write ON rental_deposit_movements FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND can_read_financial());

CREATE POLICY rental_pricing_adjustments_select ON rental_pricing_adjustments FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY rental_pricing_adjustments_write ON rental_pricing_adjustments FOR ALL TO authenticated
  USING (organization_id = auth_organization_id() AND can_read_financial())
  WITH CHECK (organization_id = auth_organization_id() AND can_read_financial());

-- =============================================================================
-- 8. Grants
-- =============================================================================

REVOKE ALL ON FUNCTION _org_timezone(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _org_timezone(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION _rental_effective_amount(numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _rental_effective_amount(numeric, numeric) TO authenticated, service_role;

REVOKE ALL ON FUNCTION list_rental_tariffs(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_rental_tariffs(text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION upsert_rental_tariff(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_rental_tariff(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION preview_rental_series(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_rental_series(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION create_rental_series(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_rental_series(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION cancel_rental_series_occurrence(uuid, date, text, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_rental_series_occurrence(uuid, date, text, text, numeric) TO authenticated;

REVOKE ALL ON FUNCTION update_rental_series(uuid, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_rental_series(uuid, jsonb, text) TO authenticated;

REVOKE ALL ON FUNCTION get_rental_series_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_rental_series_detail(uuid) TO authenticated;

REVOKE ALL ON FUNCTION create_rental_invoice(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_rental_invoice(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION record_rental_invoice_payment(uuid, numeric, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_invoice_payment(uuid, numeric, text, text) TO authenticated;

REVOKE ALL ON FUNCTION record_rental_advance(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_advance(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION allocate_rental_advance(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION allocate_rental_advance(uuid, uuid, numeric) TO authenticated;

REVOKE ALL ON FUNCTION cancel_rental_advance_allocation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_rental_advance_allocation(uuid) TO authenticated;

REVOKE ALL ON FUNCTION record_rental_deposit_movement(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_rental_deposit_movement(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION apply_rental_pricing_adjustment(uuid, numeric, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_rental_pricing_adjustment(uuid, numeric, text) TO authenticated;

REVOKE ALL ON FUNCTION list_renter_rental_invoices(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_renter_rental_invoices(uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_renter_rental_finance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_renter_rental_finance(uuid) TO authenticated;

COMMIT;
