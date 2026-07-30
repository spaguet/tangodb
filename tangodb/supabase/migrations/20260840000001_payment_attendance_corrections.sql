-- Safe payment and attendance corrections (CRM scenario 10 / Prompt 10)

BEGIN;

-- =============================================================================
-- 1. Payments — correction metadata & idempotency
-- =============================================================================

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS operation_kind TEXT NOT NULL DEFAULT 'payment'
    CHECK (operation_kind IN ('payment', 'storno')),
  ADD COLUMN IF NOT EXISTS reverses_payment_id UUID,
  ADD COLUMN IF NOT EXISTS replaces_payment_id UUID,
  ADD COLUMN IF NOT EXISTS correction_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS correction_comment TEXT,
  ADD COLUMN IF NOT EXISTS operation_number BIGINT,
  ADD COLUMN IF NOT EXISTS idempotency_key UUID,
  ADD COLUMN IF NOT EXISTS idempotency_scope TEXT,
  ADD COLUMN IF NOT EXISTS payload_fingerprint TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_reverses_payment_id_fkey'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_reverses_payment_id_fkey
      FOREIGN KEY (organization_id, reverses_payment_id)
      REFERENCES payments (organization_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payments_replaces_payment_id_fkey'
  ) THEN
    ALTER TABLE payments
      ADD CONSTRAINT payments_replaces_payment_id_fkey
      FOREIGN KEY (organization_id, replaces_payment_id)
      REFERENCES payments (organization_id, id);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_org_idempotency
  ON payments (organization_id, idempotency_scope, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_scope IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_reverses
  ON payments (organization_id, reverses_payment_id)
  WHERE reverses_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_replaces
  ON payments (organization_id, replaces_payment_id)
  WHERE replaces_payment_id IS NOT NULL;

-- Allow multiple payment rows per personal lesson after corrections; enforce net-one-active in RPC.
DROP INDEX IF EXISTS payments_org_personal_lesson_unique;

DROP INDEX IF EXISTS payments_org_subscription_sale_unique;
CREATE UNIQUE INDEX payments_org_subscription_sale_unique
  ON payments (organization_id, subscription_id)
  WHERE subscription_id IS NOT NULL
    AND personal_lesson_id IS NULL
    AND single_visit_id IS NULL
    AND operation_kind = 'payment'
    AND replaces_payment_id IS NULL;

DROP INDEX IF EXISTS payments_org_single_visit_unique;
CREATE UNIQUE INDEX payments_org_single_visit_unique
  ON payments (organization_id, single_visit_id)
  WHERE single_visit_id IS NOT NULL
    AND operation_kind = 'payment'
    AND replaces_payment_id IS NULL;

CREATE TABLE IF NOT EXISTS organization_operation_sequences (
  organization_id UUID PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  next_payment_operation_number BIGINT NOT NULL DEFAULT 1,
  next_correction_operation_number BIGINT NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS operation_idempotency (
  organization_id   UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope             TEXT NOT NULL,
  idempotency_key   UUID NOT NULL,
  payload_fingerprint TEXT NOT NULL,
  result_json       JSONB NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, scope, idempotency_key)
);

-- =============================================================================
-- 2. Attendance corrections — append-only audit
-- =============================================================================

CREATE TABLE attendance_corrections (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  subscription_id         UUID NOT NULL,
  schedule_group_id       UUID NOT NULL,
  occurrence_date         DATE NOT NULL,
  client_display            TEXT NOT NULL DEFAULT '',
  old_status              TEXT,
  new_status              TEXT NOT NULL
    CHECK (new_status IN ('present', 'absent', 'freeze', 'excused')),
  reason_code             TEXT,
  reason_comment          TEXT,
  lessons_delta           INT NOT NULL DEFAULT 0,
  freeze_delta            INT NOT NULL DEFAULT 0,
  is_undo                 BOOLEAN NOT NULL DEFAULT false,
  undoes_correction_id    UUID REFERENCES attendance_corrections (id),
  idempotency_key         UUID,
  operation_number        BIGINT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_member_id    UUID,
  FOREIGN KEY (organization_id, subscription_id)
    REFERENCES subscriptions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by_member_id)
    REFERENCES organization_members (organization_id, id)
);

CREATE UNIQUE INDEX idx_attendance_corrections_idempotency
  ON attendance_corrections (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX idx_attendance_corrections_org_date
  ON attendance_corrections (organization_id, occurrence_date DESC, created_at DESC);

-- =============================================================================
-- 3. Helpers
-- =============================================================================

CREATE OR REPLACE FUNCTION next_payment_operation_number(p_org_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  INSERT INTO organization_operation_sequences (organization_id)
  VALUES (p_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE organization_operation_sequences
  SET next_payment_operation_number = next_payment_operation_number + 1
  WHERE organization_id = p_org_id
  RETURNING next_payment_operation_number - 1 INTO v_num;

  RETURN v_num;
END;
$$;

CREATE OR REPLACE FUNCTION next_correction_operation_number(p_org_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  INSERT INTO organization_operation_sequences (organization_id)
  VALUES (p_org_id)
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE organization_operation_sequences
  SET next_correction_operation_number = next_correction_operation_number + 1
  WHERE organization_id = p_org_id
  RETURNING next_correction_operation_number - 1 INTO v_num;

  RETURN v_num;
END;
$$;

CREATE OR REPLACE FUNCTION payment_storno_total(p_org_id uuid, p_payment_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(s.amount), 0)
  FROM payments s
  WHERE s.organization_id = p_org_id
    AND s.operation_kind = 'storno'
    AND s.reverses_payment_id = p_payment_id;
$$;

CREATE OR REPLACE FUNCTION payment_remaining_amount(p_org_id uuid, p_payment_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT GREATEST(
    0,
    p.amount - payment_storno_total(p_org_id, p_payment_id)
  )
  FROM payments p
  WHERE p.organization_id = p_org_id
    AND p.id = p_payment_id
    AND p.operation_kind = 'payment';
$$;

CREATE OR REPLACE FUNCTION payment_effective_amount(p payments)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p.operation_kind = 'storno' THEN -p.amount
    ELSE p.amount
  END;
$$;

CREATE OR REPLACE FUNCTION payment_correction_status(p_org_id uuid, p_payment_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_payment payments%ROWTYPE;
  v_storno numeric;
  v_has_replacement boolean;
BEGIN
  SELECT * INTO v_payment
  FROM payments
  WHERE organization_id = p_org_id AND id = p_payment_id;

  IF NOT FOUND THEN
    RETURN 'unknown';
  END IF;

  IF v_payment.operation_kind = 'storno' THEN
    RETURN 'storno';
  END IF;

  v_storno := payment_storno_total(p_org_id, p_payment_id);

  SELECT EXISTS (
    SELECT 1
    FROM payments rep
    WHERE rep.organization_id = p_org_id
      AND rep.operation_kind = 'payment'
      AND rep.replaces_payment_id = p_payment_id
  ) INTO v_has_replacement;

  IF v_storno = 0 THEN
    RETURN 'active';
  END IF;

  IF v_has_replacement THEN
    RETURN 'replaced';
  END IF;

  IF v_storno >= v_payment.amount THEN
    RETURN 'voided';
  END IF;

  RETURN 'partially_voided';
END;
$$;

CREATE OR REPLACE FUNCTION member_can_correct_payments()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth_organization_id() IS NOT NULL
    AND can_read_financial()
    AND organization_allows_writes(auth_organization_id());
$$;

CREATE OR REPLACE FUNCTION member_can_read_corrections()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT auth.uid() IS NOT NULL
    AND auth_organization_id() IS NOT NULL
    AND (
      can_read_financial()
      OR current_member_role() IN ('owner', 'director')
    );
$$;

CREATE OR REPLACE FUNCTION check_operation_idempotency(
  p_org_id uuid,
  p_scope text,
  p_key uuid,
  p_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_existing operation_idempotency%ROWTYPE;
BEGIN
  IF p_key IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_existing
  FROM operation_idempotency
  WHERE organization_id = p_org_id
    AND scope = p_scope
    AND idempotency_key = p_key;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_existing.payload_fingerprint <> p_fingerprint THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'idempotency_conflict',
      'error_code', 'idempotency_conflict'
    );
  END IF;

  RETURN v_existing.result_json;
END;
$$;

CREATE OR REPLACE FUNCTION claim_operation_idempotency(
  p_org_id uuid,
  p_scope text,
  p_key uuid,
  p_fingerprint text,
  p_result jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN check_operation_idempotency(p_org_id, p_scope, p_key, p_fingerprint);
END;
$$;

CREATE OR REPLACE FUNCTION store_operation_idempotency(
  p_org_id uuid,
  p_scope text,
  p_key uuid,
  p_fingerprint text,
  p_result jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_key IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO operation_idempotency (
    organization_id, scope, idempotency_key, payload_fingerprint, result_json
  )
  VALUES (p_org_id, p_scope, p_key, p_fingerprint, p_result)
  ON CONFLICT (organization_id, scope, idempotency_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION sync_personal_lesson_paid_status(p_org_id uuid, p_lesson_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_net numeric := 0;
BEGIN
  SELECT COALESCE(SUM(payment_effective_amount(p)), 0)
  INTO v_net
  FROM payments p
  WHERE p.organization_id = p_org_id
    AND (
      p.personal_lesson_id = p_lesson_id
      OR (
        p.replaces_payment_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM payments orig
          WHERE orig.organization_id = p_org_id
            AND orig.id = p.replaces_payment_id
            AND orig.personal_lesson_id = p_lesson_id
        )
      )
    );

  UPDATE personal_lessons
  SET paid = CASE WHEN v_net > 0 THEN 'yes' ELSE 'no' END
  WHERE organization_id = p_org_id
    AND id = p_lesson_id;
END;
$$;

-- =============================================================================
-- 4. Idempotent record_subscription_payment
-- =============================================================================

CREATE OR REPLACE FUNCTION record_subscription_payment(
  p_subscription_id uuid,
  p_amount numeric,
  p_method text DEFAULT 'cash',
  p_method_comment text DEFAULT NULL,
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
  v_role text := current_member_role();
  v_sub subscriptions%ROWTYPE;
  v_client_display text;
  v_fingerprint text;
  v_cached jsonb;
  v_payment_id uuid;
  v_op_num bigint;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_subscription_id::text, '') || '|' ||
    coalesce(p_amount::text, '') || '|' ||
    coalesce(p_method, '') || '|' ||
    coalesce(p_method_comment, '')
  );

  v_cached := check_operation_idempotency(
    v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint
  );
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

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

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Сумма должна быть неотрицательной');
  END IF;

  SELECT * INTO v_sub
  FROM subscriptions s
  WHERE s.id = p_subscription_id AND s.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Абонемент не найден');
  END IF;

  IF v_role = 'teacher' AND NOT teacher_can_access_subscription(p_subscription_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нет доступа к этому абонементу');
  END IF;

  IF v_sub.client_id1 IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'У абонемента не указан клиент');
  END IF;

  SELECT trim(coalesce(c.last_name, '') || ' ' || coalesce(c.first_name, ''))
  INTO v_client_display
  FROM clients c
  WHERE c.organization_id = v_org_id AND c.id = v_sub.client_id1;

  -- Return existing subscription sale payment if present
  SELECT p.id INTO v_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.subscription_id = p_subscription_id
    AND p.personal_lesson_id IS NULL
    AND p.single_visit_id IS NULL
    AND p.operation_kind = 'payment'
  LIMIT 1;

  IF v_payment_id IS NOT NULL THEN
    v_result := jsonb_build_object(
      'success', true,
      'payment_id', v_payment_id,
      'already_applied', true
    );
    PERFORM store_operation_idempotency(
      v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint, v_result
    );
    RETURN v_result;
  END IF;

  v_op_num := next_payment_operation_number(v_org_id);

  PERFORM set_config('row_security', 'off', true);

  INSERT INTO payments (
    organization_id, client_id, client_display, amount, method, method_comment,
    subscription_id, created_by, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint
  )
  VALUES (
    v_org_id, v_sub.client_id1, coalesce(nullif(v_client_display, ''), 'Клиент'),
    p_amount, p_method, p_method_comment,
    v_sub.id, v_member_id, v_op_num,
    p_idempotency_key, 'record_subscription_payment', v_fingerprint
  )
  RETURNING id INTO v_payment_id;

  v_result := jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(
    v_org_id, 'record_subscription_payment', p_idempotency_key, v_fingerprint, v_result
  );

  RETURN v_result;
EXCEPTION
  WHEN unique_violation THEN
    SELECT p.id INTO v_payment_id
    FROM payments p
    WHERE p.organization_id = v_org_id
      AND p.idempotency_scope = 'record_subscription_payment'
      AND p.idempotency_key = p_idempotency_key;

    IF v_payment_id IS NOT NULL THEN
      v_result := jsonb_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'already_applied', true
      );
      RETURN v_result;
    END IF;
    RETURN jsonb_build_object('success', false, 'error', 'duplicate_payment');
END;
$$;

-- =============================================================================
-- 5. Storno & payment correction RPCs
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
  v_result jsonb;
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
    subscription_id, personal_lesson_id, single_visit_id,
    created_by, operation_kind, reverses_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint
  )
  VALUES (
    v_payment.organization_id, v_payment.client_id, v_payment.client_display,
    v_storno_amount, v_payment.method, v_payment.method_comment,
    v_payment.subscription_id, v_payment.personal_lesson_id, v_payment.single_visit_id,
    v_member_id, 'storno', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, p_idempotency_scope, p_fingerprint
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

CREATE OR REPLACE FUNCTION storno_payment(
  p_payment_id uuid,
  p_amount numeric DEFAULT NULL,
  p_reason_code text DEFAULT NULL,
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
  v_storno_amount numeric;
  v_storno_id uuid;
  v_op_num bigint;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_payment_id::text, '') || '|storno|' ||
    coalesce(p_amount::text, 'full') || '|' ||
    coalesce(p_reason_code, '') || '|' ||
    coalesce(p_reason_comment, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'storno_payment', p_idempotency_key, v_fingerprint);
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

  v_result := _storno_payment_impl(
    v_org_id, v_member_id, p_payment_id, p_amount,
    p_reason_code, p_reason_comment,
    p_idempotency_key, 'storno_payment', v_fingerprint
  );

  IF (v_result ->> 'success')::boolean THEN
    PERFORM store_operation_idempotency(v_org_id, 'storno_payment', p_idempotency_key, v_fingerprint, v_result);
  END IF;

  RETURN v_result;
END;
$$;

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
    subscription_id, personal_lesson_id, single_visit_id,
    created_by, operation_kind, replaces_payment_id,
    correction_reason_code, correction_comment, operation_number,
    idempotency_key, idempotency_scope, payload_fingerprint
  )
  VALUES (
    v_payment.organization_id, v_payment.client_id, v_payment.client_display,
    p_new_amount, p_new_method, v_payment.method_comment,
    v_payment.subscription_id, v_payment.personal_lesson_id, v_payment.single_visit_id,
    v_member_id, 'payment', v_payment.id,
    p_reason_code, p_reason_comment, v_op_num,
    p_idempotency_key, 'correct_payment', v_fingerprint
  )
  RETURNING id INTO v_new_payment_id;

  IF v_payment.personal_lesson_id IS NOT NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, v_payment.personal_lesson_id);
  END IF;

  v_result := jsonb_build_object(
    'success', true,
    'storno_id', v_storno_id,
    'payment_id', v_new_payment_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(v_org_id, 'correct_payment', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION void_personal_lesson_payment(
  p_lesson_id uuid,
  p_reason_code text DEFAULT 'duplicate',
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
  v_payment_id uuid;
  v_remaining numeric;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  SELECT p.id INTO v_payment_id
  FROM payments p
  WHERE p.organization_id = v_org_id
    AND p.personal_lesson_id = p_lesson_id
    AND p.operation_kind = 'payment'
  ORDER BY p.created_at
  LIMIT 1;

  IF v_payment_id IS NULL THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);
    RETURN jsonb_build_object('success', true, 'already_void', true);
  END IF;

  v_remaining := payment_remaining_amount(v_org_id, v_payment_id);
  IF v_remaining <= 0 THEN
    PERFORM sync_personal_lesson_paid_status(v_org_id, p_lesson_id);
    RETURN jsonb_build_object('success', true, 'already_void', true);
  END IF;

  RETURN storno_payment(
    v_payment_id,
    v_remaining,
    p_reason_code,
    p_reason_comment,
    p_idempotency_key
  );
END;
$$;

-- =============================================================================
-- 6. Attendance correction RPC (extends mark_attendance behaviour)
-- =============================================================================

CREATE OR REPLACE FUNCTION correct_attendance(
  p_date text,
  p_sub_id uuid,
  p_new_status text,
  p_schedule_group_id uuid,
  p_reason_code text DEFAULT NULL,
  p_reason_comment text DEFAULT NULL,
  p_discipline_id uuid DEFAULT NULL,
  p_idempotency_key uuid DEFAULT NULL,
  p_expected_old_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_member_id uuid := auth_member_id();
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_old_status text;
  v_correction_id uuid;
  v_op_num bigint;
  v_mark jsonb;
BEGIN
  v_fingerprint := md5(
    coalesce(p_date, '') || '|' ||
    coalesce(p_sub_id::text, '') || '|' ||
    coalesce(p_new_status, '') || '|' ||
    coalesce(p_schedule_group_id::text, '') || '|' ||
    coalesce(p_reason_code, '')
  );

  v_cached := check_operation_idempotency(v_org_id, 'correct_attendance', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    IF (v_cached ->> 'success')::boolean IS NOT TRUE AND v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  IF p_reason_code IS NULL OR trim(p_reason_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Укажите причину');
  END IF;

  SELECT a.attendance_status INTO v_old_status
  FROM attendance a
  WHERE a.organization_id = v_org_id
    AND a.subscription_id = p_sub_id
    AND a.date = p_date::date
    AND a.schedule_group_id = p_schedule_group_id;

  IF p_expected_old_status IS NOT NULL AND v_old_status IS DISTINCT FROM p_expected_old_status THEN
    RETURN jsonb_build_object('success', false, 'error', 'Состояние изменилось, обновите страницу');
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN jsonb_build_object('success', true, 'already_applied', true, 'newLessonsLeft', NULL);
  END IF;

  v_mark := mark_attendance(
    p_date,
    p_sub_id::text,
    p_new_status,
    p_discipline_id,
    p_schedule_group_id
  );

  IF NOT (v_mark ->> 'success')::boolean THEN
    RETURN v_mark;
  END IF;

  v_op_num := next_correction_operation_number(v_org_id);

  INSERT INTO attendance_corrections (
    organization_id, subscription_id, schedule_group_id, occurrence_date,
    client_display, old_status, new_status,
    reason_code, reason_comment, idempotency_key, operation_number,
    created_by_member_id
  )
  SELECT
    v_org_id, p_sub_id, p_schedule_group_id, p_date::date,
    coalesce(a.client_display, ''), v_old_status, p_new_status,
    p_reason_code, p_reason_comment, p_idempotency_key, v_op_num,
    v_member_id
  FROM subscriptions s
  LEFT JOIN attendance a
    ON a.organization_id = v_org_id
     AND a.subscription_id = p_sub_id
     AND a.date = p_date::date
     AND a.schedule_group_id = p_schedule_group_id
  WHERE s.organization_id = v_org_id AND s.id = p_sub_id
  RETURNING id INTO v_correction_id;

  v_result := v_mark || jsonb_build_object(
    'correction_id', v_correction_id,
    'operation_number', v_op_num,
    'old_status', v_old_status
  );

  PERFORM store_operation_idempotency(v_org_id, 'correct_attendance', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION undo_attendance_correction(
  p_correction_id uuid,
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
  v_corr attendance_corrections%ROWTYPE;
  v_fingerprint text;
  v_cached jsonb;
  v_result jsonb;
  v_mark jsonb;
  v_undo_id uuid;
  v_op_num bigint;
BEGIN
  v_fingerprint := md5('undo|' || coalesce(p_correction_id::text, ''));

  v_cached := check_operation_idempotency(v_org_id, 'undo_attendance', p_idempotency_key, v_fingerprint);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  SELECT * INTO v_corr
  FROM attendance_corrections
  WHERE id = p_correction_id AND organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Запись не найдена');
  END IF;

  IF v_corr.created_at < now() - interval '30 seconds' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Окно быстрой отмены истекло');
  END IF;

  IF v_corr.is_undo THEN
    RETURN jsonb_build_object('success', false, 'error', 'Нельзя отменить отмену');
  END IF;

  IF EXISTS (
    SELECT 1 FROM attendance_corrections u
    WHERE u.undoes_correction_id = p_correction_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Уже отменено');
  END IF;

  IF v_corr.old_status IS NULL THEN
    -- revert to absent (delete attendance row) via mark to absent then delete? use mark_attendance to absent if was null
    v_mark := mark_attendance(
      to_char(v_corr.occurrence_date, 'YYYY-MM-DD'),
      v_corr.subscription_id::text,
      'absent',
      NULL,
      v_corr.schedule_group_id
    );
  ELSE
    v_mark := mark_attendance(
      to_char(v_corr.occurrence_date, 'YYYY-MM-DD'),
      v_corr.subscription_id::text,
      v_corr.old_status,
      NULL,
      v_corr.schedule_group_id
    );
  END IF;

  IF NOT (v_mark ->> 'success')::boolean THEN
    RETURN v_mark;
  END IF;

  v_op_num := next_correction_operation_number(v_org_id);

  INSERT INTO attendance_corrections (
    organization_id, subscription_id, schedule_group_id, occurrence_date,
    client_display, old_status, new_status,
    reason_code, is_undo, undoes_correction_id, operation_number,
    created_by_member_id
  )
  VALUES (
    v_org_id, v_corr.subscription_id, v_corr.schedule_group_id, v_corr.occurrence_date,
    v_corr.client_display, v_corr.new_status, coalesce(v_corr.old_status, 'absent'),
    'undo', true, v_corr.id, v_op_num, v_member_id
  )
  RETURNING id INTO v_undo_id;

  v_result := v_mark || jsonb_build_object(
    'success', true,
    'undo_id', v_undo_id,
    'operation_number', v_op_num
  );

  PERFORM store_operation_idempotency(v_org_id, 'undo_attendance', p_idempotency_key, v_fingerprint, v_result);
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 7. Corrections report
-- =============================================================================

CREATE OR REPLACE FUNCTION get_corrections_report(
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_payments jsonb;
  v_attendance jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Не авторизован');
  END IF;

  IF NOT member_can_read_corrections() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Недостаточно прав');
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.created_at DESC), '[]'::jsonb)
  INTO v_payments
  FROM (
    SELECT
      'payment'::text AS kind,
      p.id,
      p.operation_number,
      p.operation_kind,
      p.amount,
      p.method,
      p.client_display,
      p.correction_reason_code AS reason_code,
      p.correction_comment AS reason_comment,
      p.reverses_payment_id,
      p.replaces_payment_id,
      p.created_at,
      om.display_name AS author_name,
      payment_correction_status(v_org_id, coalesce(p.reverses_payment_id, p.id)) AS related_status
    FROM payments p
    LEFT JOIN organization_members om
      ON om.organization_id = p.organization_id AND om.id = p.created_by
    WHERE p.organization_id = v_org_id
      AND (
        p.operation_kind = 'storno'
        OR p.replaces_payment_id IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM payments s
          WHERE s.organization_id = v_org_id
            AND s.reverses_payment_id = p.id
        )
      )
      AND (p_date_from IS NULL OR p.created_at::date >= p_date_from)
      AND (p_date_to IS NULL OR p.created_at::date <= p_date_to)
  ) x;

  SELECT coalesce(jsonb_agg(row_to_json(y)::jsonb ORDER BY y.created_at DESC), '[]'::jsonb)
  INTO v_attendance
  FROM (
    SELECT
      'attendance'::text AS kind,
      ac.id,
      ac.operation_number,
      ac.client_display,
      ac.old_status,
      ac.new_status,
      ac.reason_code,
      ac.reason_comment,
      ac.is_undo,
      ac.occurrence_date,
      ac.created_at,
      om.display_name AS author_name
    FROM attendance_corrections ac
    LEFT JOIN organization_members om
      ON om.organization_id = ac.organization_id AND om.id = ac.created_by_member_id
    WHERE ac.organization_id = v_org_id
      AND (p_date_from IS NULL OR ac.occurrence_date >= p_date_from)
      AND (p_date_to IS NULL OR ac.occurrence_date <= p_date_to)
  ) y;

  RETURN jsonb_build_object(
    'success', true,
    'payments', v_payments,
    'attendance', v_attendance
  );
END;
$$;

-- =============================================================================
-- 8. Teacher settlement — net payment effect
-- =============================================================================

CREATE OR REPLACE FUNCTION payroll_payment_net_amount(p_org_id uuid, p_payment_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(SUM(payment_effective_amount(p)), 0)
  FROM payments p
  WHERE p.organization_id = p_org_id
    AND (
      p.id = p_payment_id
      OR p.reverses_payment_id = p_payment_id
      OR p.replaces_payment_id = p_payment_id
    );
$$;

-- =============================================================================
-- 9. RLS — append-only audit
-- =============================================================================

ALTER TABLE attendance_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE operation_idempotency ENABLE ROW LEVEL SECURITY;

CREATE POLICY attendance_corrections_select
  ON attendance_corrections FOR SELECT TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND business_row_readable()
    AND (
      can_read_operational()
      OR member_can_read_corrections()
    )
  );

CREATE POLICY attendance_corrections_insert_none
  ON attendance_corrections FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY attendance_corrections_update_none
  ON attendance_corrections FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY attendance_corrections_delete_none
  ON attendance_corrections FOR DELETE TO authenticated
  USING (false);

CREATE POLICY operation_idempotency_deny_all
  ON operation_idempotency FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

GRANT SELECT ON attendance_corrections TO authenticated;

REVOKE ALL ON FUNCTION storno_payment(uuid, numeric, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION storno_payment(uuid, numeric, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION correct_payment(uuid, numeric, text, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION correct_payment(uuid, numeric, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION void_personal_lesson_payment(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION void_personal_lesson_payment(uuid, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION correct_attendance(text, uuid, text, uuid, text, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION correct_attendance(text, uuid, text, uuid, text, text, uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION undo_attendance_correction(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION undo_attendance_correction(uuid, uuid) TO authenticated;

REVOKE ALL ON FUNCTION get_corrections_report(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_corrections_report(date, date) TO authenticated;

COMMIT;
