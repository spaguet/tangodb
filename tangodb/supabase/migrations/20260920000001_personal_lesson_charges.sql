-- Personal tariff stage 2 (PL-TARIFF Prompt 10): personal_lesson_charges + equal split.
-- Legacy lessons: one backfilled charge on payer_client_id ?? client_id1.

BEGIN;

-- =============================================================================
-- 1. Schema
-- =============================================================================

ALTER TABLE personal_lessons
  ADD COLUMN IF NOT EXISTS billing_split_mode text NOT NULL DEFAULT 'single_payer'
    CHECK (billing_split_mode IN ('single_payer', 'equal'));

CREATE TABLE IF NOT EXISTS personal_lesson_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  personal_lesson_id uuid NOT NULL,
  client_id uuid NOT NULL,
  billed_amount numeric NOT NULL CHECK (billed_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT personal_lesson_charges_org_id_unique UNIQUE (organization_id, id),
  CONSTRAINT personal_lesson_charges_org_lesson_client_unique
    UNIQUE (organization_id, personal_lesson_id, client_id),
  CONSTRAINT personal_lesson_charges_org_lesson_fkey
    FOREIGN KEY (organization_id, personal_lesson_id)
    REFERENCES personal_lessons (organization_id, id) ON DELETE CASCADE,
  CONSTRAINT personal_lesson_charges_org_client_fkey
    FOREIGN KEY (organization_id, client_id)
    REFERENCES clients (organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS personal_lesson_charges_lesson_idx
  ON personal_lesson_charges (organization_id, personal_lesson_id);

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS personal_lesson_charge_id uuid NULL;

ALTER TABLE payments
  DROP CONSTRAINT IF EXISTS payments_organization_id_personal_lesson_charge_id_fkey;

ALTER TABLE payments
  ADD CONSTRAINT payments_organization_id_personal_lesson_charge_id_fkey
  FOREIGN KEY (organization_id, personal_lesson_charge_id)
  REFERENCES personal_lesson_charges (organization_id, id)
  ON DELETE RESTRICT;

-- =============================================================================
-- 2. Split / charge net helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION split_billed_equally(p_total numeric, p_count integer)
RETURNS numeric[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_share numeric;
  v_remainder numeric;
  v_result numeric[];
  i integer;
BEGIN
  IF p_count IS NULL OR p_count <= 0 THEN
    RAISE EXCEPTION 'split_billed_equally: count must be positive';
  END IF;

  IF p_count = 1 THEN
    RETURN ARRAY[ROUND(p_total, 2)];
  END IF;

  v_share := ROUND(p_total / p_count, 2);
  v_result := ARRAY[]::numeric[];

  FOR i IN 1..p_count LOOP
    v_result := array_append(v_result, v_share);
  END LOOP;

  v_remainder := ROUND(p_total - v_share * p_count, 2);
  IF v_remainder <> 0 THEN
    v_result[1] := ROUND(v_result[1] + v_remainder, 2);
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION personal_lesson_charge_net_payment(p_org_id uuid, p_charge_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(payment_effective_amount(p)), 0)
  FROM payments p
  WHERE p.organization_id = p_org_id
    AND p.personal_lesson_charge_id = p_charge_id;
$$;

CREATE OR REPLACE FUNCTION personal_lesson_participant_ids_ordered(
  p_client_id1 uuid,
  p_client_id2 uuid,
  p_client_id3 uuid,
  p_client_id4 uuid,
  p_payer_client_id uuid,
  p_payer_first boolean DEFAULT false
)
RETURNS uuid[]
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_payer uuid := COALESCE(p_payer_client_id, p_client_id1);
  v_ids uuid[] := ARRAY[]::uuid[];
  v_id uuid;
BEGIN
  IF p_payer_first AND v_payer IS NOT NULL THEN
    v_ids := array_append(v_ids, v_payer);
  END IF;

  FOREACH v_id IN ARRAY ARRAY[p_client_id1, p_client_id2, p_client_id3, p_client_id4] LOOP
    IF v_id IS NULL THEN
      CONTINUE;
    END IF;
    IF p_payer_first AND v_id = v_payer THEN
      CONTINUE;
    END IF;
    IF NOT v_id = ANY (v_ids) THEN
      v_ids := array_append(v_ids, v_id);
    END IF;
  END LOOP;

  RETURN v_ids;
END;
$$;

-- =============================================================================
-- 3. Create / sync charges (SECURITY DEFINER — no direct client insert)
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_personal_lesson_charges(p_org_id uuid, p_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lesson personal_lessons%ROWTYPE;
  v_participants uuid[];
  v_splits numeric[];
  v_idx integer;
  v_payer_id uuid;
  v_total_billed numeric;
BEGIN
  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE organization_id = p_org_id
    AND id = p_lesson_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_lesson.subscription_id IS NOT NULL AND COALESCE(v_lesson.price, 0) = 0 THEN
    DELETE FROM personal_lesson_charges
    WHERE organization_id = p_org_id
      AND personal_lesson_id = p_lesson_id;
    RETURN;
  END IF;

  IF personal_lesson_has_payment_rows(p_org_id, p_lesson_id) THEN
  -- Keep existing charge rows; only denormalize lesson.price from charges.
    SELECT COALESCE(SUM(billed_amount), 0) INTO v_total_billed
    FROM personal_lesson_charges
    WHERE organization_id = p_org_id
      AND personal_lesson_id = p_lesson_id;

    IF v_total_billed > 0 THEN
      UPDATE personal_lessons
      SET price = v_total_billed
      WHERE organization_id = p_org_id
        AND id = p_lesson_id;
    END IF;
    RETURN;
  END IF;

  DELETE FROM personal_lesson_charges
  WHERE organization_id = p_org_id
    AND personal_lesson_id = p_lesson_id;

  v_total_billed := COALESCE(v_lesson.price, 0);

  IF v_lesson.billing_split_mode = 'equal' THEN
    v_participants := personal_lesson_participant_ids_ordered(
      v_lesson.client_id1,
      v_lesson.client_id2,
      v_lesson.client_id3,
      v_lesson.client_id4,
      v_lesson.payer_client_id,
      true
    );

    IF COALESCE(array_length(v_participants, 1), 0) >= 2 THEN
      v_splits := split_billed_equally(v_total_billed, array_length(v_participants, 1));
      FOR v_idx IN 1..array_length(v_participants, 1) LOOP
        INSERT INTO personal_lesson_charges (
          organization_id, personal_lesson_id, client_id, billed_amount
        )
        VALUES (
          p_org_id,
          p_lesson_id,
          v_participants[v_idx],
          v_splits[v_idx]
        );
      END LOOP;
    ELSE
      v_payer_id := COALESCE(v_lesson.payer_client_id, v_lesson.client_id1);
      INSERT INTO personal_lesson_charges (
        organization_id, personal_lesson_id, client_id, billed_amount
      )
      VALUES (p_org_id, p_lesson_id, v_payer_id, v_total_billed);
    END IF;
  ELSE
    v_payer_id := COALESCE(v_lesson.payer_client_id, v_lesson.client_id1);
    INSERT INTO personal_lesson_charges (
      organization_id, personal_lesson_id, client_id, billed_amount
    )
    VALUES (p_org_id, p_lesson_id, v_payer_id, v_total_billed);
  END IF;

  SELECT COALESCE(SUM(billed_amount), 0) INTO v_total_billed
  FROM personal_lesson_charges
  WHERE organization_id = p_org_id
    AND personal_lesson_id = p_lesson_id;

  UPDATE personal_lessons
  SET price = v_total_billed
  WHERE organization_id = p_org_id
    AND id = p_lesson_id;
END;
$$;

REVOKE ALL ON FUNCTION sync_personal_lesson_charges(uuid, uuid) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION personal_lessons_sync_charges_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM sync_personal_lesson_charges(NEW.organization_id, NEW.id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.subscription_id IS NOT NULL AND COALESCE(NEW.price, 0) = 0 THEN
      DELETE FROM personal_lesson_charges
      WHERE organization_id = NEW.organization_id
        AND personal_lesson_id = NEW.id;
      RETURN NEW;
    END IF;

    IF NOT personal_lesson_has_payment_rows(NEW.organization_id, NEW.id)
      AND (
        NEW.price IS DISTINCT FROM OLD.price
        OR NEW.billing_split_mode IS DISTINCT FROM OLD.billing_split_mode
        OR NEW.client_id1 IS DISTINCT FROM OLD.client_id1
        OR NEW.client_id2 IS DISTINCT FROM OLD.client_id2
        OR NEW.client_id3 IS DISTINCT FROM OLD.client_id3
        OR NEW.client_id4 IS DISTINCT FROM OLD.client_id4
        OR NEW.payer_client_id IS DISTINCT FROM OLD.payer_client_id
      )
    THEN
      PERFORM sync_personal_lesson_charges(NEW.organization_id, NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS personal_lessons_sync_charges_trg ON personal_lessons;

CREATE TRIGGER personal_lessons_sync_charges_trg
AFTER INSERT OR UPDATE ON personal_lessons
FOR EACH ROW
EXECUTE FUNCTION personal_lessons_sync_charges_trigger();

-- Backfill one charge per existing lesson without charges.
INSERT INTO personal_lesson_charges (organization_id, personal_lesson_id, client_id, billed_amount)
SELECT
  pl.organization_id,
  pl.id,
  COALESCE(pl.payer_client_id, pl.client_id1),
  COALESCE(pl.price, 0)
FROM personal_lessons pl
WHERE NOT EXISTS (
  SELECT 1
  FROM personal_lesson_charges plc
  WHERE plc.organization_id = pl.organization_id
    AND plc.personal_lesson_id = pl.id
)
AND pl.client_id1 IS NOT NULL
AND NOT (pl.subscription_id IS NOT NULL AND COALESCE(pl.price, 0) = 0);

-- Link legacy personal payments to the single backfilled charge per lesson.
UPDATE payments p
SET personal_lesson_charge_id = plc.id
FROM personal_lesson_charges plc
WHERE p.organization_id = plc.organization_id
  AND p.personal_lesson_id = plc.personal_lesson_id
  AND p.personal_lesson_charge_id IS NULL
  AND p.personal_lesson_id IS NOT NULL
  AND (
    SELECT COUNT(*)::integer
    FROM personal_lesson_charges c2
    WHERE c2.organization_id = p.organization_id
      AND c2.personal_lesson_id = p.personal_lesson_id
  ) = 1;

-- Multi-charge: attribute legacy payments to charge matching payments.client_id.
UPDATE payments p
SET personal_lesson_charge_id = plc.id
FROM personal_lesson_charges plc
WHERE p.organization_id = plc.organization_id
  AND p.personal_lesson_id = plc.personal_lesson_id
  AND p.client_id = plc.client_id
  AND p.personal_lesson_charge_id IS NULL
  AND p.personal_lesson_id IS NOT NULL;

-- =============================================================================
-- 4. sync_personal_lesson_paid_status — aggregate per charge
-- =============================================================================

CREATE OR REPLACE FUNCTION sync_personal_lesson_paid_status(p_org_id uuid, p_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_price numeric;
  v_total_billed numeric;
  v_total_paid numeric;
BEGIN
  SELECT COALESCE(SUM(plc.billed_amount), 0) INTO v_total_billed
  FROM personal_lesson_charges plc
  WHERE plc.organization_id = p_org_id
    AND plc.personal_lesson_id = p_lesson_id;

  IF v_total_billed > 0 THEN
    SELECT COALESCE(SUM(personal_lesson_charge_net_payment(p_org_id, plc.id)), 0) INTO v_total_paid
    FROM personal_lesson_charges plc
    WHERE plc.organization_id = p_org_id
      AND plc.personal_lesson_id = p_lesson_id;

    UPDATE personal_lessons
    SET
      price = v_total_billed,
      paid_amount = GREATEST(v_total_paid, 0),
      paid = CASE WHEN v_total_paid >= v_total_billed THEN 'yes' ELSE 'no' END
    WHERE organization_id = p_org_id
      AND id = p_lesson_id;
    RETURN;
  END IF;

  -- Fallback when no charges (should not happen after backfill).
  v_total_paid := COALESCE(personal_lesson_net_payment(p_org_id, p_lesson_id), 0);

  SELECT price INTO v_price
  FROM personal_lessons
  WHERE organization_id = p_org_id AND id = p_lesson_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE personal_lessons
  SET
    paid_amount = GREATEST(v_total_paid, 0),
    paid = CASE
      WHEN v_price > 0 THEN (CASE WHEN v_total_paid >= v_price THEN 'yes' ELSE 'no' END)
      ELSE paid
    END
  WHERE organization_id = p_org_id
    AND id = p_lesson_id;
END;
$$;

-- =============================================================================
-- 5. record_personal_lesson_payment — charge-scoped cap + personal_lesson_charge_id
-- =============================================================================

DROP FUNCTION IF EXISTS record_personal_lesson_payment(
  uuid, numeric, text, uuid, boolean, uuid, numeric, integer, numeric, text, integer, uuid
);

CREATE OR REPLACE FUNCTION _record_personal_lesson_payment_impl(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_price_id uuid DEFAULT NULL,
  p_tariff_units numeric DEFAULT NULL,
  p_tariff_duration_minutes integer DEFAULT NULL,
  p_tariff_price numeric DEFAULT NULL,
  p_tariff_label text DEFAULT NULL,
  p_lesson_duration_minutes integer DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_charge_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_role text := current_member_role();
  v_lesson personal_lessons%ROWTYPE;
  v_price prices%ROWTYPE;
  v_charge personal_lesson_charges%ROWTYPE;
  v_payer_id uuid;
  v_client_display text;
  v_payment_id uuid;
  v_op_num bigint;
  v_result jsonb;
  v_net_paid_lesson numeric;
  v_charge_net_paid numeric;
  v_remaining numeric;
  v_lesson_minutes integer;
  v_effective_price_id uuid;
  v_pay_price_id uuid;
  v_pay_tariff_duration integer;
  v_pay_tariff_price numeric;
  v_pay_tariff_label text;
  v_pay_tariff_units numeric;
  v_pay_lesson_duration integer;
  v_new_billed numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Организация в режиме только чтения');
  END IF;

  IF NOT member_can_accept_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет прав на запись платежа');
  END IF;

  IF p_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть больше нуля');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Урок не найден');
  END IF;

  IF v_role = 'teacher' AND v_lesson.teacher_member_id IS DISTINCT FROM v_member_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступа к этому уроку');
  END IF;

  IF v_lesson.client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'У урока не указан клиент');
  END IF;

  v_payer_id := COALESCE(p_client_id, v_lesson.client_id1);

  IF NOT personal_lesson_client_is_participant(
    v_payer_id,
    v_lesson.client_id1,
    v_lesson.client_id2,
    v_lesson.client_id3,
    v_lesson.client_id4
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Клиент не является участником урока');
  END IF;

  PERFORM sync_personal_lesson_charges(v_org_id, p_lesson_id);

  IF p_charge_id IS NOT NULL THEN
    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND id = p_charge_id
      AND personal_lesson_id = p_lesson_id
    FOR UPDATE;
  ELSE
    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND personal_lesson_id = p_lesson_id
      AND client_id = v_payer_id
    FOR UPDATE;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Начисление не найдено');
  END IF;

  IF v_charge.client_id <> v_payer_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж должен закрывать долг выбранного клиента');
  END IF;

  v_lesson_minutes := COALESCE(
    p_lesson_duration_minutes,
    personal_lesson_slot_minutes(v_lesson.time_start, v_lesson.time_end)
  );

  IF v_lesson.subscription_id IS NULL
    AND v_lesson.price_id IS NULL
    AND p_price_id IS NOT NULL
  THEN
    SELECT * INTO v_price
    FROM prices pr
    WHERE pr.organization_id = v_org_id
      AND pr.id = p_price_id
      AND pr.category = 'private'
      AND pr.lessons = 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'Тариф персонального урока не найден');
    END IF;

    v_new_billed := billed_from_tariff(
      v_price.price,
      v_lesson_minutes,
      v_price.duration_minutes
    );

    IF v_new_billed IS NULL OR v_new_billed < 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'Некорректная сумма начисления');
    END IF;

    UPDATE personal_lessons
    SET
      price_id = p_price_id,
      price = v_new_billed
    WHERE organization_id = v_org_id
      AND id = p_lesson_id;

    v_lesson.price_id := p_price_id;
    v_lesson.price := v_new_billed;

    PERFORM sync_personal_lesson_charges(v_org_id, p_lesson_id);

    SELECT * INTO v_charge
    FROM personal_lesson_charges
    WHERE organization_id = v_org_id
      AND id = v_charge.id
    FOR UPDATE;
  END IF;

  v_charge_net_paid := COALESCE(personal_lesson_charge_net_payment(v_org_id, v_charge.id), 0);

  IF v_charge.billed_amount > 0 AND v_charge_net_paid >= v_charge.billed_amount THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Долг этого клиента уже полностью оплачен',
      'error_code', 'already_fully_paid'
    );
  END IF;

  v_remaining := GREATEST(v_charge.billed_amount - v_charge_net_paid, 0);

  IF p_amount > v_remaining THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Сумма превышает остаток к оплате',
      'error_code', 'amount_exceeds_remaining'
    );
  END IF;

  v_net_paid_lesson := COALESCE(personal_lesson_net_payment(v_org_id, p_lesson_id), 0);

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id AND c.id = v_payer_id;

  v_effective_price_id := v_lesson.price_id;

  IF v_effective_price_id IS NOT NULL AND v_lesson.subscription_id IS NULL THEN
    IF p_tariff_price IS NOT NULL
      OR p_tariff_duration_minutes IS NOT NULL
      OR p_tariff_label IS NOT NULL
      OR p_tariff_units IS NOT NULL
      OR p_lesson_duration_minutes IS NOT NULL
    THEN
      v_pay_price_id := COALESCE(p_price_id, v_effective_price_id);
      v_pay_tariff_duration := p_tariff_duration_minutes;
      v_pay_tariff_price := p_tariff_price;
      v_pay_tariff_label := p_tariff_label;
      v_pay_tariff_units := p_tariff_units;
      v_pay_lesson_duration := p_lesson_duration_minutes;
    ELSE
      SELECT * INTO v_price
      FROM prices pr
      WHERE pr.organization_id = v_org_id AND pr.id = v_effective_price_id;

      v_pay_price_id := v_effective_price_id;
      v_pay_tariff_duration := v_price.duration_minutes;
      v_pay_tariff_price := v_price.price;
      v_pay_tariff_label := v_price.label;
      v_pay_tariff_units := tariff_units_snapshot(v_lesson_minutes, v_price.duration_minutes);
      v_pay_lesson_duration := v_lesson_minutes;
    END IF;

    IF v_pay_tariff_duration IS NULL THEN
      v_pay_tariff_units := NULL;
    END IF;
  ELSE
    v_pay_price_id := NULL;
    v_pay_tariff_duration := NULL;
    v_pay_tariff_price := NULL;
    v_pay_tariff_label := NULL;
    v_pay_tariff_units := NULL;
    v_pay_lesson_duration := NULL;
  END IF;

  v_op_num := next_payment_operation_number(v_org_id);

  INSERT INTO payments (
    organization_id,
    client_id,
    client_display,
    amount,
    method,
    personal_lesson_id,
    personal_lesson_charge_id,
    created_by,
    operation_number,
    idempotency_key,
    idempotency_scope,
    payload_fingerprint,
    price_id,
    tariff_duration_minutes,
    tariff_units,
    tariff_price,
    tariff_label,
    lesson_duration_minutes
  )
  VALUES (
    v_org_id,
    v_payer_id,
    coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_amount,
    p_method,
    v_lesson.id,
    v_charge.id,
    v_member_id,
    v_op_num,
    p_idempotency_key,
    'record_personal_lesson_payment',
    md5(
      coalesce(p_lesson_id::text, '') || '|' ||
      coalesce(p_amount::text, '') || '|' ||
      coalesce(p_method, '') || '|' ||
      coalesce(v_pay_price_id::text, '') || '|' ||
      coalesce(v_pay_tariff_units::text, '') || '|' ||
      coalesce(v_payer_id::text, '') || '|' ||
      coalesce(v_charge.id::text, '')
    ),
    v_pay_price_id,
    v_pay_tariff_duration,
    v_pay_tariff_units,
    v_pay_tariff_price,
    v_pay_tariff_label,
    v_pay_lesson_duration
  )
  RETURNING id INTO v_payment_id;

  PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'operation_number', v_op_num
  );

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT p.id INTO v_payment_id
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND p.idempotency_scope = 'record_personal_lesson_payment'
      AND p.idempotency_key = p_idempotency_key;

    IF v_payment_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'already_applied', true
      );
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'duplicate_payment');
END;
$$;

REVOKE ALL ON FUNCTION _record_personal_lesson_payment_impl(
  uuid, numeric, text, uuid, uuid, numeric, integer, numeric, text, integer, uuid, uuid
) FROM PUBLIC, authenticated;

CREATE OR REPLACE FUNCTION record_personal_lesson_payment(
  p_lesson_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_idempotency_key uuid DEFAULT NULL,
  p_venue_rule_acknowledged boolean DEFAULT false,
  p_price_id uuid DEFAULT NULL,
  p_tariff_units numeric DEFAULT NULL,
  p_tariff_duration_minutes integer DEFAULT NULL,
  p_tariff_price numeric DEFAULT NULL,
  p_tariff_label text DEFAULT NULL,
  p_lesson_duration_minutes integer DEFAULT NULL,
  p_client_id uuid DEFAULT NULL,
  p_charge_id uuid DEFAULT NULL
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
    '|',
    p_lesson_id,
    p_amount,
    p_method,
    p_venue_rule_acknowledged,
    p_price_id,
    p_tariff_units,
    p_client_id,
    p_charge_id
  ));
  v_legacy_fingerprint text := md5(
    coalesce(p_lesson_id::text, '') || '|' ||
    coalesce(p_amount::text, '') || '|' ||
    coalesce(p_method, '')
  );
BEGIN
  v_cached := check_operation_idempotency(
    v_org_id, 'record_personal_lesson_payment', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict'
      AND NOT COALESCE(p_venue_rule_acknowledged, false)
    THEN
      v_cached := check_operation_idempotency(
        v_org_id,
        'record_personal_lesson_payment',
        p_idempotency_key,
        v_legacy_fingerprint
      );
    END IF;
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  v_status := venue_cost_status_for_org(v_org_id, current_date);
  IF COALESCE((v_status ->> 'acknowledgement_required')::boolean, false)
    AND NOT COALESCE(p_venue_rule_acknowledged, false)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'venue_rule_ack_required',
      'error', 'venue_rule_ack_required',
      'venue_rule_status', v_status
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

  v_result := _record_personal_lesson_payment_impl(
    p_lesson_id,
    p_amount,
    p_method,
    p_idempotency_key,
    p_price_id,
    p_tariff_units,
    p_tariff_duration_minutes,
    p_tariff_price,
    p_tariff_label,
    p_lesson_duration_minutes,
    p_client_id,
    p_charge_id
  );

  IF COALESCE((v_result ->> 'success')::boolean, false) THEN
    IF v_existing_payment_id IS NULL
      AND NOT COALESCE((v_result ->> 'already_applied')::boolean, false)
    THEN
      PERFORM store_venue_payment_ack_if_required(
        v_status,
        (v_result ->> 'payment_id')::uuid,
        'record_personal_lesson_payment',
        p_idempotency_key
      );
    END IF;
    PERFORM store_operation_idempotency(
      v_org_id,
      'record_personal_lesson_payment',
      p_idempotency_key,
      v_fingerprint,
      v_result
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION record_personal_lesson_payment(
  uuid, numeric, text, uuid, boolean, uuid, numeric, integer, numeric, text, integer, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_personal_lesson_payment(
  uuid, numeric, text, uuid, boolean, uuid, numeric, integer, numeric, text, integer, uuid, uuid
) TO authenticated, service_role;

-- =============================================================================
-- 6. restate — only single charge
-- =============================================================================

CREATE OR REPLACE FUNCTION restate_personal_lesson_amount(
  p_lesson_id uuid,
  p_new_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_lesson personal_lessons%ROWTYPE;
  v_paid numeric;
  v_charge_count integer;
  v_charge_id uuid;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF NOT organization_allows_writes(v_org_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.orgReadOnly');
  END IF;

  IF NOT can_read_financial() THEN
    RETURN jsonb_build_object('success', false, 'error', 'schedule.error.unauthorized');
  END IF;

  IF p_lesson_id IS NULL OR p_new_amount IS NULL OR p_new_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustInvalid');
  END IF;

  SELECT * INTO v_lesson
  FROM personal_lessons
  WHERE id = p_lesson_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustFailed');
  END IF;

  SELECT COUNT(*)::integer INTO v_charge_count
  FROM personal_lesson_charges
  WHERE organization_id = v_org_id
    AND personal_lesson_id = p_lesson_id;

  IF v_charge_count <> 1 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'finance.debtors.adjustSplitNotSupported'
    );
  END IF;

  v_paid := COALESCE(v_lesson.paid_amount, 0);

  IF p_new_amount < v_paid THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.debtors.adjustBelowPaid');
  END IF;

  SELECT id INTO v_charge_id
  FROM personal_lesson_charges
  WHERE organization_id = v_org_id
    AND personal_lesson_id = p_lesson_id
  LIMIT 1;

  UPDATE personal_lesson_charges
  SET billed_amount = p_new_amount
  WHERE organization_id = v_org_id
    AND id = v_charge_id;

  UPDATE personal_lessons
  SET
    price = p_new_amount,
    price_id = NULL,
    paid = CASE WHEN p_new_amount <= v_paid THEN 'yes' ELSE 'no' END
  WHERE id = p_lesson_id
    AND organization_id = v_org_id;

  RETURN jsonb_build_object(
    'success', true,
    'old_amount', v_lesson.price,
    'new_amount', p_new_amount,
    'paid_amount', v_paid
  );
END;
$$;

-- =============================================================================
-- 7. Storno / correction — copy personal_lesson_charge_id
-- =============================================================================

CREATE OR REPLACE FUNCTION _storno_payment_impl(
  p_org_id uuid,
  p_member_id uuid,
  p_payment_id uuid,
  p_amount numeric,
  p_reason_code text,
  p_reason_comment text,
  p_idempotency_key uuid,
  p_idempotency_scope text,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_remaining numeric;
  v_storno_amount numeric;
  v_storno_id uuid;
  v_op_num bigint;
BEGIN
  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id AND organization_id = p_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж не найден');
  END IF;

  v_remaining := payment_remaining_amount(p_org_id, p_payment_id);

  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж уже полностью аннулирован');
  END IF;

  v_storno_amount := COALESCE(p_amount, v_remaining);

  IF v_storno_amount <= 0 OR v_storno_amount > v_remaining THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Сумма сторно превышает доступный остаток'
    );
  END IF;

  v_op_num := next_payment_operation_number(p_org_id);

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method, method_comment,
    subscription_id, personal_lesson_id, personal_lesson_charge_id, single_visit_id,
    created_by, operation_kind, reverses_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint,
    price_id, tariff_duration_minutes, tariff_units, tariff_price, tariff_label, lesson_duration_minutes
  )
  VALUES (
    v_payment.organization_id, v_payment.client_id, v_payment.client_display,
    v_storno_amount, v_payment.method, v_payment.method_comment,
    v_payment.subscription_id, v_payment.personal_lesson_id, v_payment.personal_lesson_charge_id,
    v_payment.single_visit_id,
    p_member_id, 'storno', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, p_idempotency_scope, p_fingerprint,
    v_payment.price_id, v_payment.tariff_duration_minutes, v_payment.tariff_units,
    v_payment.tariff_price, v_payment.tariff_label, v_payment.lesson_duration_minutes
  )
  RETURNING id INTO v_storno_id;

  IF v_payment.personal_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(p_org_id, v_payment.personal_lesson_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'storno_id', v_storno_id,
    'operation_number', v_op_num,
    'remaining_after', payment_remaining_amount(p_org_id, p_payment_id)
  );
END;
$$;

-- correct_payment: add charge_id to replacement INSERT (body tail only — full function from prior migration)
CREATE OR REPLACE FUNCTION correct_payment(
  p_payment_id uuid,
  p_new_amount numeric,
  p_new_method text,
  p_reason_code text,
  p_reason_comment text DEFAULT NULL,
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
  v_payment payments%ROWTYPE;
  v_remaining numeric;
  v_storno_id uuid;
  v_new_payment_id uuid;
  v_op_num bigint;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_storno_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|correct|' ||
    coalesce(p_new_amount::text, '') || '|' ||
    coalesce(p_new_method, '') || '|' ||
    coalesce(p_reason_code, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'correct_payment', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_correct_payments() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  IF p_reason_code IS NULL OR trim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите причину');
  END IF;

  IF p_new_method NOT IN ('cash', 'transfer', 'card', 'other') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недопустимый способ оплаты');
  END IF;

  IF p_new_amount IS NULL OR p_new_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть положительной');
  END IF;

  SELECT * INTO v_payment
  FROM payments
  WHERE id = p_payment_id AND organization_id = v_org_id
  FOR UPDATE;

  IF NOT FOUND OR v_payment.operation_kind <> 'payment' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж не найден');
  END IF;

  IF payment_correction_status(v_org_id, p_payment_id) IN ('voided', 'replaced') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Платёж уже исправлен или аннулирован');
  END IF;

  v_remaining := payment_remaining_amount(v_org_id, p_payment_id);
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступного остатка для сторно');
  END IF;

  v_storno_result := _storno_payment_impl(
    v_org_id,
    v_member_id,
    p_payment_id,
    v_remaining,
    p_reason_code,
    p_reason_comment,
    NULL,
    NULL,
    NULL
  );

  IF NOT (v_storno_result ->> 'success')::boolean THEN
    RETURN v_storno_result;
  END IF;

  v_storno_id := (v_storno_result ->> 'storno_id')::uuid;
  v_op_num := next_payment_operation_number(v_org_id);

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method, method_comment,
    subscription_id, personal_lesson_id, personal_lesson_charge_id, single_visit_id,
    created_by, operation_kind, replaces_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint,
    price_id, tariff_duration_minutes, tariff_units, tariff_price, tariff_label, lesson_duration_minutes
  )
  VALUES (
    v_payment.organization_id, v_payment.client_id, v_payment.client_display,
    p_new_amount, p_new_method, v_payment.method_comment,
    v_payment.subscription_id, v_payment.personal_lesson_id, v_payment.personal_lesson_charge_id,
    v_payment.single_visit_id,
    v_member_id, 'payment', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, 'correct_payment', v_fingerprint,
    v_payment.price_id, v_payment.tariff_duration_minutes, v_payment.tariff_units,
    v_payment.tariff_price, v_payment.tariff_label, v_payment.lesson_duration_minutes
  )
  RETURNING id INTO v_new_payment_id;

  IF v_payment.personal_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, v_payment.personal_lesson_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_new_payment_id,
    'storno_id', v_storno_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(v_org_id, 'correct_payment', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 8. financial_debtors_v — one row per unpaid charge
-- =============================================================================

DROP VIEW IF EXISTS financial_debtors_v;

CREATE OR REPLACE VIEW financial_debtors_v
WITH (security_invoker = false) AS
SELECT
  s.organization_id,
  ('sub-' || s.id::text) AS id,
  NULL::uuid AS personal_lesson_id,
  NULL::uuid AS personal_lesson_charge_id,
  s.client_id1 AS client_id1,
  s.client_id2 AS client_id2,
  s.client_id3 AS client_id3,
  NULL::uuid AS client_id4,
  NULL::uuid AS payer_client_id,
  NULL::text AS lesson_time_start,
  NULL::text AS lesson_time_end,
  NULL::uuid AS location_id,
  s.discipline_id AS discipline_id,
  NULL::uuid AS teacher_member_id,
  'subscription'::text AS kind,
  COALESCE(
    NULLIF(
      TRIM(BOTH ' &' FROM CONCAT_WS(
        ' & ',
        TRIM(c1.last_name || ' ' || c1.first_name),
        CASE WHEN s.client_id2 IS NOT NULL THEN TRIM(c2.last_name || ' ' || c2.first_name) END,
        CASE WHEN s.client_id3 IS NOT NULL THEN TRIM(c3.last_name || ' ' || c3.first_name) END
      )),
      ''
    ),
    s.client_id1::text
  ) AS client_display,
  COALESCE(NULLIF(TRIM(c1.telegram), ''), '—') AS contact,
  ('Осталось ' || s.lessons_left::text || ' из ' || s.lessons_total::text || ' занятий') AS detail,
  0::numeric AS amount,
  0::numeric AS billed_amount,
  0::numeric AS paid_amount,
  s.lessons_left,
  s.lessons_total,
  NULL::date AS lesson_date,
  NULL::uuid AS rental_id,
  NULL::uuid AS renter_id,
  NULL::uuid AS price_id,
  NULL::text AS other_participants
FROM subscriptions s
INNER JOIN clients c1
  ON c1.organization_id = s.organization_id AND c1.id = s.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = s.organization_id AND c2.id = s.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = s.organization_id AND c3.id = s.client_id3
LEFT JOIN organization_settings os
  ON os.organization_id = s.organization_id
WHERE s.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND s.status = 'active'
  AND s.lessons_left <= COALESCE(os.low_balance_threshold, 2)

UNION ALL

SELECT
  pl.organization_id,
  ('plc-' || plc.id::text) AS id,
  pl.id AS personal_lesson_id,
  plc.id AS personal_lesson_charge_id,
  pl.client_id1,
  pl.client_id2,
  pl.client_id3,
  pl.client_id4,
  plc.client_id AS payer_client_id,
  pl.time_start AS lesson_time_start,
  pl.time_end AS lesson_time_end,
  pl.location_id,
  pl.discipline_id,
  pl.teacher_member_id,
  'personal'::text AS kind,
  COALESCE(
    NULLIF(TRIM(cp.last_name || ' ' || cp.first_name), ''),
    plc.client_id::text,
    'Клиент не указан'
  ) AS client_display,
  COALESCE(NULLIF(TRIM(cp.telegram), ''), '—') AS contact,
  CASE
    WHEN NULLIF(
      TRIM(BOTH ', ' FROM CONCAT_WS(
        ', ',
        CASE
          WHEN pl.client_id1 IS NOT NULL AND pl.client_id1 IS DISTINCT FROM plc.client_id
          THEN TRIM(c1.last_name || ' ' || c1.first_name)
        END,
        CASE
          WHEN pl.client_id2 IS NOT NULL AND pl.client_id2 IS DISTINCT FROM plc.client_id
          THEN TRIM(c2.last_name || ' ' || c2.first_name)
        END,
        CASE
          WHEN pl.client_id3 IS NOT NULL AND pl.client_id3 IS DISTINCT FROM plc.client_id
          THEN TRIM(c3.last_name || ' ' || c3.first_name)
        END,
        CASE
          WHEN pl.client_id4 IS NOT NULL AND pl.client_id4 IS DISTINCT FROM plc.client_id
          THEN TRIM(c4.last_name || ' ' || c4.first_name)
        END
      )),
      ''
    ) IS NOT NULL THEN
      ('Персональный · ' || pl.date::text || ' · с '
        || TRIM(BOTH ', ' FROM CONCAT_WS(
          ', ',
          CASE
            WHEN pl.client_id1 IS NOT NULL AND pl.client_id1 IS DISTINCT FROM plc.client_id
            THEN TRIM(c1.last_name || ' ' || c1.first_name)
          END,
          CASE
            WHEN pl.client_id2 IS NOT NULL AND pl.client_id2 IS DISTINCT FROM plc.client_id
            THEN TRIM(c2.last_name || ' ' || c2.first_name)
          END,
          CASE
            WHEN pl.client_id3 IS NOT NULL AND pl.client_id3 IS DISTINCT FROM plc.client_id
            THEN TRIM(c3.last_name || ' ' || c3.first_name)
          END,
          CASE
            WHEN pl.client_id4 IS NOT NULL AND pl.client_id4 IS DISTINCT FROM plc.client_id
            THEN TRIM(c4.last_name || ' ' || c4.first_name)
          END
        )))
    ELSE
      ('Персональный · ' || pl.date::text)
  END AS detail,
  GREATEST(
    plc.billed_amount - personal_lesson_charge_net_payment(pl.organization_id, plc.id),
    0
  ) AS amount,
  plc.billed_amount AS billed_amount,
  personal_lesson_charge_net_payment(pl.organization_id, plc.id) AS paid_amount,
  NULL::integer AS lessons_left,
  NULL::integer AS lessons_total,
  pl.date AS lesson_date,
  NULL::uuid AS rental_id,
  NULL::uuid AS renter_id,
  pl.price_id AS price_id,
  NULLIF(
    TRIM(BOTH ', ' FROM CONCAT_WS(
      ', ',
      CASE
        WHEN pl.client_id1 IS NOT NULL AND pl.client_id1 IS DISTINCT FROM plc.client_id
        THEN TRIM(c1.last_name || ' ' || c1.first_name)
      END,
      CASE
        WHEN pl.client_id2 IS NOT NULL AND pl.client_id2 IS DISTINCT FROM plc.client_id
        THEN TRIM(c2.last_name || ' ' || c2.first_name)
      END,
      CASE
        WHEN pl.client_id3 IS NOT NULL AND pl.client_id3 IS DISTINCT FROM plc.client_id
        THEN TRIM(c3.last_name || ' ' || c3.first_name)
      END,
      CASE
        WHEN pl.client_id4 IS NOT NULL AND pl.client_id4 IS DISTINCT FROM plc.client_id
        THEN TRIM(c4.last_name || ' ' || c4.first_name)
      END
    )),
    ''
  ) AS other_participants
FROM personal_lesson_charges plc
INNER JOIN personal_lessons pl
  ON pl.organization_id = plc.organization_id
  AND pl.id = plc.personal_lesson_id
LEFT JOIN clients cp
  ON cp.organization_id = plc.organization_id
  AND cp.id = plc.client_id
LEFT JOIN clients c1
  ON c1.organization_id = pl.organization_id AND c1.id = pl.client_id1
LEFT JOIN clients c2
  ON c2.organization_id = pl.organization_id AND c2.id = pl.client_id2
LEFT JOIN clients c3
  ON c3.organization_id = pl.organization_id AND c3.id = pl.client_id3
LEFT JOIN clients c4
  ON c4.organization_id = pl.organization_id AND c4.id = pl.client_id4
WHERE pl.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND pl.paid = 'no'
  AND GREATEST(
    plc.billed_amount - personal_lesson_charge_net_payment(pl.organization_id, plc.id),
    0
  ) > 0

UNION ALL

SELECT
  r.organization_id,
  ('rent-' || r.id::text) AS id,
  NULL::uuid AS personal_lesson_id,
  NULL::uuid AS personal_lesson_charge_id,
  NULL::uuid AS client_id1,
  NULL::uuid AS client_id2,
  NULL::uuid AS client_id3,
  NULL::uuid AS client_id4,
  NULL::uuid AS payer_client_id,
  r.time_start AS lesson_time_start,
  r.time_end AS lesson_time_end,
  r.location_id,
  NULL::uuid AS discipline_id,
  NULL::uuid AS teacher_member_id,
  'rental'::text AS kind,
  ren.display_name AS client_display,
  COALESCE(
    NULLIF(TRIM(ren.contact_phone), ''),
    NULLIF(TRIM(ren.contact_email), ''),
    '—'
  ) AS contact,
  ('Аренда · ' || r.rental_date::text || COALESCE(' · ' || loc.name, '')) AS detail,
  GREATEST(
    _rental_effective_amount(r.fixed_amount, r.final_amount)
      - _rental_paid_total(r.id, r.organization_id),
    0
  ) AS amount,
  _rental_effective_amount(r.fixed_amount, r.final_amount) AS billed_amount,
  _rental_paid_total(r.id, r.organization_id) AS paid_amount,
  NULL::integer AS lessons_left,
  NULL::integer AS lessons_total,
  r.rental_date AS lesson_date,
  r.id AS rental_id,
  r.renter_id AS renter_id,
  NULL::uuid AS price_id,
  NULL::text AS other_participants
FROM rentals r
INNER JOIN renters ren
  ON ren.id = r.renter_id AND ren.organization_id = r.organization_id
LEFT JOIN locations loc
  ON loc.id = r.location_id AND loc.organization_id = r.organization_id
WHERE r.organization_id = auth_organization_id()
  AND business_row_readable()
  AND can_read_financial()
  AND r.booking_status = 'confirmed'
  AND _rental_effective_amount(r.fixed_amount, r.final_amount) > 0
  AND _rental_paid_total(r.id, r.organization_id)
      < _rental_effective_amount(r.fixed_amount, r.final_amount);

GRANT SELECT ON financial_debtors_v TO authenticated;

-- =============================================================================
-- 9. RLS personal_lesson_charges
-- =============================================================================

ALTER TABLE personal_lesson_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY personal_lesson_charges_select_full_access
  ON personal_lesson_charges FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_all_business()
  );

CREATE POLICY personal_lesson_charges_select_financial
  ON personal_lesson_charges FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND can_read_financial()
  );

CREATE POLICY personal_lesson_charges_select_teacher
  ON personal_lesson_charges FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND current_member_role() = 'teacher'
    AND EXISTS (
      SELECT 1
      FROM personal_lessons pl
      WHERE pl.organization_id = personal_lesson_charges.organization_id
        AND pl.id = personal_lesson_charges.personal_lesson_id
        AND teacher_can_access_lesson(pl.id)
    )
  );

COMMIT;
