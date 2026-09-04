-- FA6 / 2.9.40: P0-01 operational — staff topup preview + append-only topup_reversal.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Ledger columns + entry_type topup_reversal
-- ---------------------------------------------------------------------------

ALTER TABLE renter_wallet_ledger
  ADD COLUMN IF NOT EXISTS corrects_ledger_id uuid,
  ADD COLUMN IF NOT EXISTS correction_reason text,
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS external_reference text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'renter_wallet_ledger_corrects_ledger_fk'
  ) THEN
    ALTER TABLE renter_wallet_ledger
      ADD CONSTRAINT renter_wallet_ledger_corrects_ledger_fk
      FOREIGN KEY (organization_id, corrects_ledger_id)
      REFERENCES renter_wallet_ledger (organization_id, id);
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'renter_wallet_ledger_created_by_fk'
  ) THEN
    ALTER TABLE renter_wallet_ledger
      ADD CONSTRAINT renter_wallet_ledger_created_by_fk
      FOREIGN KEY (organization_id, created_by)
      REFERENCES organization_members (organization_id, id);
  END IF;
END;
$$;

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_entry_type_check;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_entry_type_check
  CHECK (entry_type IN (
    'topup',
    'topup_reversal',
    'prepay_charge',
    'remainder_charge',
    'refund',
    'debt_settle',
    'surcharge_one_time_recalc'
  ));

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_check;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_check
  CHECK (
    (
      entry_type IN ('topup', 'topup_reversal')
      AND rental_id IS NULL
    )
    OR (entry_type NOT IN ('topup', 'topup_reversal'))
  );

ALTER TABLE renter_wallet_ledger
  DROP CONSTRAINT IF EXISTS renter_wallet_ledger_topup_reversal_meta_chk;

ALTER TABLE renter_wallet_ledger
  ADD CONSTRAINT renter_wallet_ledger_topup_reversal_meta_chk
  CHECK (
    entry_type <> 'topup_reversal'
    OR (
      corrects_ledger_id IS NOT NULL
      AND correction_reason IS NOT NULL
      AND length(trim(correction_reason)) >= 3
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS renter_wallet_ledger_topup_reversal_unique
  ON renter_wallet_ledger (organization_id, corrects_ledger_id)
  WHERE entry_type = 'topup_reversal';

ALTER TABLE rental_advances
  DROP CONSTRAINT IF EXISTS rental_advances_amount_check;

ALTER TABLE rental_advances
  ADD CONSTRAINT rental_advances_amount_check
  CHECK (amount >= 0);

-- ---------------------------------------------------------------------------
-- 2. Balance helper — subtract topup_reversal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_wallet_balance(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(
    CASE
      WHEN l.entry_type IN ('topup', 'refund') THEN l.amount
      WHEN l.entry_type IN (
        'topup_reversal',
        'prepay_charge',
        'remainder_charge',
        'debt_settle',
        'surcharge_one_time_recalc'
      ) THEN -l.amount
      ELSE 0
    END
  ), 0)::numeric(12, 2)
  FROM renter_wallet_ledger l
  WHERE l.organization_id = p_org_id
    AND l.renter_id = p_renter_id;
$$;

-- ---------------------------------------------------------------------------
-- 3. Topup insert — external_reference + created_by
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_wallet_insert_topup(
  p_org_id uuid,
  p_renter_id uuid,
  p_amount numeric,
  p_advance_id uuid,
  p_topup_request_id uuid,
  p_external_reference text DEFAULT NULL,
  p_created_by uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase,
    topup_request_id, external_reference, created_by
  )
  VALUES (
    p_org_id, p_renter_id, 'topup', p_amount::numeric(12, 2), NULL, p_advance_id, NULL,
    p_topup_request_id, NULLIF(trim(p_external_reference), ''), p_created_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

DROP FUNCTION IF EXISTS _renter_credit_wallet_topup(uuid, uuid, numeric, text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION _renter_credit_wallet_topup(
  p_org_id uuid,
  p_renter_id uuid,
  p_amount numeric,
  p_method text,
  p_member_id uuid,
  p_topup_request_id uuid,
  p_notes text,
  p_external_reference text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_today date;
  v_advance uuid;
  v_currency text;
  v_advance_method text;
  v_note text;
BEGIN
  v_today := _org_local_date(p_org_id);

  IF _is_finance_period_closed(p_org_id, v_today) THEN
    PERFORM _renter_raise('finance.error.periodClosed');
  END IF;

  IF NOT organization_allows_writes(p_org_id) THEN
    PERFORM _renter_raise('renter.writesDisabled');
  END IF;

  v_currency := _renter_org_currency(p_org_id);
  v_advance_method := CASE WHEN p_method = 'qr' THEN 'transfer' ELSE 'cash' END;
  v_note := NULLIF(trim(COALESCE(p_notes, '')), '');
  IF p_external_reference IS NOT NULL AND trim(p_external_reference) <> '' THEN
    v_note := COALESCE(v_note || E'\n', '') || 'ref: ' || trim(p_external_reference);
  END IF;

  INSERT INTO rental_advances (
    organization_id, renter_id, amount, allocated_amount, currency, method,
    created_by, notes, operation_date
  )
  VALUES (
    p_org_id,
    p_renter_id,
    p_amount,
    p_amount,
    v_currency,
    v_advance_method,
    p_member_id,
    v_note,
    v_today
  )
  RETURNING id INTO v_advance;

  PERFORM _renter_wallet_insert_topup(
    p_org_id, p_renter_id, p_amount, v_advance, p_topup_request_id,
    p_external_reference, p_member_id
  );
  PERFORM _renter_apply_wallet(p_org_id, p_renter_id);

  RETURN v_advance;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. staff_renter_wallet_topup — pass external_reference (FA2 claim unchanged)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION staff_renter_wallet_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_renter uuid;
  v_amount numeric;
  v_method text;
  v_key uuid;
  v_fp text;
  v_cached jsonb;
  v_currency text;
  v_advance uuid;
  v_external_ref text;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);
  v_method := COALESCE(NULLIF(trim(p_payload ->> 'method'), ''), 'cash');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;
  v_external_ref := NULLIF(trim(p_payload ->> 'external_reference'), '');

  IF v_renter IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;
  IF v_amount > 1000000 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountTooLarge');
  END IF;
  IF v_method NOT IN ('qr', 'cash') THEN
    v_method := 'cash';
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.idempotencyRequired');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM renters r WHERE r.id = v_renter AND r.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_fp := md5(v_renter::text || ':' || v_amount::text || ':' || v_method);

  PERFORM _renter_acquire_miniapp_locks(v_org, v_renter, '[]'::jsonb);

  v_cached := claim_operation_idempotency(v_org, 'staff_renter_wallet_topup', v_key, v_fp);
  IF v_cached IS NOT NULL THEN
    IF v_cached ->> 'error_code' = 'idempotency_conflict' THEN
      RETURN v_cached;
    END IF;
    RETURN v_cached || jsonb_build_object('already_applied', true);
  END IF;

  v_advance := _renter_credit_wallet_topup(
    v_org, v_renter, v_amount, v_method, v_member, NULL, 'staff_wallet_topup', v_external_ref
  );

  v_result := jsonb_build_object(
    'success', true,
    'advance_id', v_advance,
    'amount', v_amount
  );
  PERFORM store_operation_idempotency(v_org, 'staff_renter_wallet_topup', v_key, v_fp, v_result);
  RETURN v_result;
EXCEPTION
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Preview staff topup effect (read-only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_preview_staff_topup_effect(
  p_org_id uuid,
  p_renter_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_wallet numeric;
  v_spendable numeric;
  v_reserved numeric;
  v_debt numeric;
  v_debt_to_settle numeric := 0;
  v_holds_prepay numeric := 0;
  v_holds_count integer := 0;
  v_spendable_work numeric;
  v_slot record;
  v_now timestamptz := now();
  v_start timestamptz;
BEGIN
  v_wallet := _renter_wallet_balance(p_org_id, p_renter_id);
  v_spendable := _renter_wallet_spendable(p_org_id, p_renter_id);
  v_reserved := _renter_wallet_reserved_prepay(p_org_id, p_renter_id);
  v_debt := _renter_wallet_debt_outstanding(p_org_id, p_renter_id);
  v_spendable_work := v_spendable + p_amount;

  FOR v_slot IN
    SELECT r.id, r.debt_amount
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.debt_amount > 0
    ORDER BY
      _renter_slot_ts(r.organization_id, r.rental_date, r.time_end),
      r.created_at
  LOOP
    EXIT WHEN v_spendable_work <= 0;
    EXIT WHEN v_spendable_work < v_slot.debt_amount;
    v_debt_to_settle := v_debt_to_settle + v_slot.debt_amount;
    v_spendable_work := v_spendable_work - v_slot.debt_amount;
  END LOOP;

  FOR v_slot IN
    SELECT r.prepay_amount, r.rental_date, r.time_start, r.hold_expires_at
    FROM rentals r
    WHERE r.organization_id = p_org_id
      AND r.renter_id = p_renter_id
      AND r.channel = 'miniapp'
      AND r.lifecycle = 'awaiting_payment'
    ORDER BY r.rental_date, r.time_start, r.created_at
  LOOP
    v_start := _renter_slot_ts(p_org_id, v_slot.rental_date, v_slot.time_start);
    IF v_now >= v_start
       OR (v_slot.hold_expires_at IS NOT NULL AND v_now >= v_slot.hold_expires_at) THEN
      CONTINUE;
    END IF;
    IF v_spendable_work - v_holds_prepay < v_slot.prepay_amount THEN
      CONTINUE;
    END IF;
    v_holds_prepay := v_holds_prepay + v_slot.prepay_amount;
    v_holds_count := v_holds_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'wallet_balance_before', v_wallet,
    'wallet_balance_after', v_wallet + p_amount - v_debt_to_settle - v_holds_prepay,
    'spendable_before', v_spendable,
    'spendable_after', GREATEST(0, v_spendable_work - v_holds_prepay),
    'miniapp_debt_before', v_debt,
    'miniapp_debt_after', GREATEST(0, v_debt - v_debt_to_settle),
    'reserved_prepay_before', v_reserved,
    'debt_to_settle', v_debt_to_settle,
    'holds_prepay_total', v_holds_prepay,
    'holds_to_activate', v_holds_count
  );
END;
$$;

CREATE OR REPLACE FUNCTION preview_staff_renter_wallet_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_renter uuid;
  v_amount numeric;
  v_method text;
  v_currency text;
  v_renter_name text;
  v_effect jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_renter := NULLIF(p_payload ->> 'renter_id', '')::uuid;
  v_currency := _renter_org_currency(v_org);
  v_amount := _renter_round_money((p_payload ->> 'amount')::numeric, v_currency);
  v_method := COALESCE(NULLIF(trim(p_payload ->> 'method'), ''), 'cash');

  IF v_renter IS NULL OR v_amount IS NULL OR v_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.amountInvalid');
  END IF;
  IF v_method NOT IN ('qr', 'cash') THEN
    v_method := 'cash';
  END IF;

  SELECT r.display_name INTO v_renter_name
  FROM renters r
  WHERE r.id = v_renter AND r.organization_id = v_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_effect := _renter_preview_staff_topup_effect(v_org, v_renter, v_amount);

  RETURN jsonb_build_object(
    'success', true,
    'renter_id', v_renter,
    'renter_name', v_renter_name,
    'amount', v_amount,
    'method', v_method,
    'external_reference', NULLIF(trim(p_payload ->> 'external_reference'), ''),
    'effect', v_effect
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Append-only topup reversal
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION reverse_renter_wallet_topup(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org uuid := auth_organization_id();
  v_member uuid := auth_member_id();
  v_ledger_id uuid;
  v_reason text;
  v_key uuid;
  v_orig renter_wallet_ledger%ROWTYPE;
  v_reversal_id uuid;
  v_today date;
BEGIN
  IF auth.uid() IS NULL OR v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;
  IF NOT member_can_record_rental_payment() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  v_ledger_id := NULLIF(p_payload ->> 'ledger_entry_id', '')::uuid;
  v_reason := NULLIF(trim(p_payload ->> 'reason'), '');
  v_key := NULLIF(p_payload ->> 'idempotency_key', '')::uuid;

  IF v_ledger_id IS NULL OR v_reason IS NULL OR length(v_reason) < 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalReasonRequired');
  END IF;
  IF v_key IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.idempotencyRequired');
  END IF;

  v_today := _org_local_date(v_org);
  IF _is_finance_period_closed(v_org, v_today) THEN
    RETURN jsonb_build_object('success', false, 'error', 'finance.error.periodClosed');
  END IF;

  SELECT * INTO v_orig
  FROM renter_wallet_ledger l
  WHERE l.id = v_ledger_id
    AND l.organization_id = v_org
    AND l.entry_type = 'topup';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalNotAllowed');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM renter_wallet_ledger r
    WHERE r.organization_id = v_org
      AND r.corrects_ledger_id = v_orig.id
      AND r.entry_type = 'topup_reversal'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalAlreadyApplied');
  END IF;

  IF _renter_wallet_spendable(v_org, v_orig.renter_id) < v_orig.amount THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalInsufficient');
  END IF;

  PERFORM _renter_acquire_miniapp_locks(v_org, v_orig.renter_id, '[]'::jsonb);

  INSERT INTO renter_wallet_ledger (
    organization_id, renter_id, entry_type, amount, rental_id, advance_id, phase,
    corrects_ledger_id, correction_reason, created_by
  )
  VALUES (
    v_org, v_orig.renter_id, 'topup_reversal', v_orig.amount, NULL, NULL, NULL,
    v_orig.id, v_reason, v_member
  )
  RETURNING id INTO v_reversal_id;

  IF v_orig.advance_id IS NOT NULL THEN
    UPDATE rental_advances ra
    SET
      amount = GREATEST(0, ra.amount - v_orig.amount),
      allocated_amount = GREATEST(0, ra.allocated_amount - v_orig.amount),
      notes = COALESCE(ra.notes || E'\n', '') || 'topup_reversal: ' || v_reason
    WHERE ra.id = v_orig.advance_id
      AND ra.organization_id = v_org;
  END IF;

  PERFORM _renter_apply_wallet(v_org, v_orig.renter_id);
  PERFORM _renter_assert_wallet_invariant(v_org, v_orig.renter_id);

  RETURN jsonb_build_object(
    'success', true,
    'reversal_id', v_reversal_id,
    'amount', v_orig.amount
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('success', false, 'error', 'renter.topup.reversalAlreadyApplied');
  WHEN SQLSTATE 'P0001' THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Wallet entries for get_renter_detail
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _renter_wallet_entries_detail_json(
  p_org_id uuid,
  p_renter_id uuid,
  p_limit integer DEFAULT 20
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'entry_type', e.entry_type,
      'amount', e.amount,
      'created_at', e.created_at,
      'external_reference', e.external_reference,
      'correction_reason', e.correction_reason,
      'corrects_ledger_id', e.corrects_ledger_id,
      'can_reverse', e.can_reverse
    ) ORDER BY e.created_at DESC
  ), '[]'::jsonb)
  FROM (
    SELECT
      l.id,
      l.entry_type,
      l.amount,
      l.created_at,
      l.external_reference,
      l.correction_reason,
      l.corrects_ledger_id,
      (
        l.entry_type = 'topup'
        AND l.advance_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM renter_wallet_ledger r
          WHERE r.organization_id = l.organization_id
            AND r.corrects_ledger_id = l.id
            AND r.entry_type = 'topup_reversal'
        )
      ) AS can_reverse
    FROM renter_wallet_ledger l
    WHERE l.organization_id = p_org_id
      AND l.renter_id = p_renter_id
    ORDER BY l.created_at DESC
    LIMIT p_limit
  ) e;
$$;

-- Patch get_renter_detail wallet entries only (full body from R2).
CREATE OR REPLACE FUNCTION get_renter_detail(p_renter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_renter renters%ROWTYPE;
  v_can_finance boolean;
  v_can_profile boolean;
  v_can_documents boolean;
  v_contacts jsonb;
  v_contracts jsonb;
  v_documents_list jsonb;
  v_communications jsonb;
  v_finance_summary jsonb;
  v_rental_counts jsonb;
  v_paid numeric;
  v_fixed numeric;
  v_debt numeric;
  v_wallet numeric;
  v_spendable numeric;
  v_reserved numeric;
  v_miniapp_debt numeric;
  v_wallet_entries jsonb;
  v_miniapp_debts jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.unauthorized');
  END IF;

  IF NOT member_can_read_renter_directory() THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.forbidden');
  END IF;

  SELECT * INTO v_renter
  FROM renters r
  WHERE r.id = p_renter_id AND r.organization_id = v_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'renters.error.notFound');
  END IF;

  v_can_finance := member_can_read_renter_finance();
  v_can_profile := member_can_read_renter_profile();
  v_can_documents := member_can_read_renter_documents();

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', rc.id,
      'full_name', rc.full_name,
      'role_title', rc.role_title,
      'phone', rc.phone,
      'email', rc.email,
      'telegram', rc.telegram,
      'is_primary', rc.is_primary,
      'notes', rc.notes
    ) ORDER BY rc.is_primary DESC, rc.full_name), '[]'::jsonb)
    INTO v_contacts
    FROM renter_contacts rc
    WHERE rc.organization_id = v_org_id AND rc.renter_id = p_renter_id;
  ELSE
    v_contacts := '[]'::jsonb;
  END IF;

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'contract_number', c.contract_number,
      'title', c.title,
      'contract_type', c.contract_type,
      'signed_at', c.signed_at,
      'valid_from', c.valid_from,
      'valid_to', c.valid_to,
      'status', c.status,
      'signatory_name', c.signatory_name,
      'location_ids', c.location_ids,
      'deposit_info', c.deposit_info
    ) ORDER BY c.valid_from DESC NULLS LAST, c.created_at DESC), '[]'::jsonb)
    INTO v_contracts
    FROM renter_contracts c
    WHERE c.organization_id = v_org_id AND c.renter_id = p_renter_id;
  ELSE
    v_contracts := '[]'::jsonb;
  END IF;

  IF v_can_documents THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', d.id,
      'contract_id', d.contract_id,
      'category', d.category,
      'display_name', d.display_name,
      'document_date', d.document_date,
      'valid_until', d.valid_until,
      'mime_type', d.mime_type,
      'file_size', d.file_size,
      'created_at', d.created_at
    ) ORDER BY d.created_at DESC), '[]'::jsonb)
    INTO v_documents_list
    FROM renter_documents d
    WHERE d.organization_id = v_org_id AND d.renter_id = p_renter_id;
  ELSE
    v_documents_list := '[]'::jsonb;
  END IF;

  IF v_can_profile THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', cm.id,
      'comm_type', cm.comm_type,
      'occurred_at', cm.occurred_at,
      'subject', cm.subject,
      'body', cm.body,
      'contact_id', cm.contact_id,
      'next_action_at', cm.next_action_at,
      'author_member_id', cm.author_member_id,
      'created_at', cm.created_at
    ) ORDER BY cm.occurred_at DESC), '[]'::jsonb)
    INTO v_communications
    FROM renter_communications cm
    WHERE cm.organization_id = v_org_id AND cm.renter_id = p_renter_id;
  ELSE
    v_communications := '[]'::jsonb;
  END IF;

  IF v_can_finance THEN
    SELECT COALESCE(sum(_rental_paid_total(r.id, r.organization_id)), 0)
    INTO v_paid
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = p_renter_id
      AND r.booking_status = 'confirmed'
      AND r.channel = 'cashier';

    SELECT COALESCE(sum(_rental_effective_amount(r.fixed_amount, r.final_amount)), 0)
    INTO v_fixed
    FROM rentals r
    WHERE r.organization_id = v_org_id
      AND r.renter_id = p_renter_id
      AND r.booking_status = 'confirmed'
      AND r.channel = 'cashier';

    v_debt := _renter_debt_total(p_renter_id, v_org_id);
    v_wallet := _renter_wallet_balance(v_org_id, p_renter_id);
    v_spendable := _renter_wallet_spendable(v_org_id, p_renter_id);
    v_reserved := _renter_wallet_reserved_prepay(v_org_id, p_renter_id);
    v_miniapp_debt := _renter_wallet_debt_outstanding(v_org_id, p_renter_id);
    v_wallet_entries := _renter_wallet_entries_detail_json(v_org_id, p_renter_id, 20);

    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'rental_id', d.id,
        'rental_date', d.rental_date,
        'time_start', d.time_start,
        'time_end', d.time_end,
        'debt_amount', d.debt_amount,
        'location_id', d.location_id
      ) ORDER BY d.rental_date, d.time_start
    ), '[]'::jsonb)
    INTO v_miniapp_debts
    FROM rentals d
    WHERE d.organization_id = v_org_id
      AND d.renter_id = p_renter_id
      AND d.channel = 'miniapp'
      AND COALESCE(d.debt_amount, 0) > 0;

    v_finance_summary := jsonb_build_object(
      'fixed_total', v_fixed,
      'paid_total', v_paid,
      'debt_total', v_debt,
      'overpaid_total', GREATEST(COALESCE(v_paid, 0) - COALESCE(v_fixed, 0), 0),
      'wallet_balance', v_wallet,
      'spendable', v_spendable,
      'reserved_prepay', v_reserved,
      'miniapp_debt_total', v_miniapp_debt,
      'wallet_entries', v_wallet_entries,
      'miniapp_debts', v_miniapp_debts
    );
  ELSE
    v_finance_summary := NULL;
  END IF;

  SELECT jsonb_build_object(
    'completed', count(*) FILTER (WHERE r.rental_date < current_date AND r.booking_status = 'confirmed'),
    'upcoming', count(*) FILTER (WHERE r.rental_date >= current_date AND r.booking_status = 'confirmed'),
    'cancelled', count(*) FILTER (WHERE r.booking_status = 'cancelled')
  )
  INTO v_rental_counts
  FROM rentals r
  WHERE r.organization_id = v_org_id AND r.renter_id = p_renter_id;

  RETURN jsonb_build_object(
    'success', true,
    'renter', jsonb_build_object(
      'id', v_renter.id,
      'display_name', v_renter.display_name,
      'counterparty_type', CASE WHEN v_can_profile THEN v_renter.counterparty_type ELSE NULL END,
      'status', v_renter.status,
      'contact_phone', CASE WHEN v_can_profile THEN v_renter.contact_phone ELSE NULL END,
      'contact_email', CASE WHEN v_can_profile THEN v_renter.contact_email ELSE NULL END,
      'telegram_id', CASE
        WHEN v_can_profile AND v_renter.telegram_id IS NOT NULL THEN v_renter.telegram_id::text
        ELSE NULL
      END,
      'legal_name', CASE WHEN v_can_profile THEN v_renter.legal_name ELSE NULL END,
      'tax_id', CASE WHEN v_can_profile THEN v_renter.tax_id ELSE NULL END,
      'registration_number', CASE WHEN v_can_profile THEN v_renter.registration_number ELSE NULL END,
      'legal_address', CASE WHEN v_can_profile THEN v_renter.legal_address ELSE NULL END,
      'actual_address', CASE WHEN v_can_profile THEN v_renter.actual_address ELSE NULL END,
      'blocked_reason', CASE WHEN v_can_profile THEN v_renter.blocked_reason ELSE NULL END,
      'internal_notes', CASE WHEN v_can_profile THEN v_renter.internal_notes ELSE NULL END,
      'preferred_location_ids', CASE WHEN v_can_profile THEN v_renter.preferred_location_ids ELSE NULL END,
      'payment_due_days', CASE WHEN v_can_profile THEN v_renter.payment_due_days ELSE NULL END,
      'notes', CASE WHEN v_can_profile THEN v_renter.notes ELSE NULL END,
      'archived_at', v_renter.archived_at,
      'next_rental_date', _renter_next_rental_date(p_renter_id, v_org_id),
      'on_time_count', CASE WHEN v_can_finance THEN v_renter.on_time_count ELSE NULL END,
      'untimely_count', CASE WHEN v_can_finance THEN v_renter.untimely_count ELSE NULL END,
      'booking_banned_at', CASE WHEN v_can_finance THEN v_renter.booking_banned_at ELSE NULL END,
      'penalty_tariff_applied_at', CASE WHEN v_can_finance THEN v_renter.penalty_tariff_applied_at ELSE NULL END
    ),
    'contacts', v_contacts,
    'contracts', v_contracts,
    'documents', v_documents_list,
    'communications', v_communications,
    'finance', v_finance_summary,
    'rental_counts', v_rental_counts
  );
END;
$$;

REVOKE ALL ON FUNCTION preview_staff_renter_wallet_topup(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION reverse_renter_wallet_topup(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION preview_staff_renter_wallet_topup(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reverse_renter_wallet_topup(jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION preview_staff_renter_wallet_topup(jsonb) IS
  'FA6: read-only preview of staff direct topup effect for review dialog.';
COMMENT ON FUNCTION reverse_renter_wallet_topup(jsonb) IS
  'FA6: append-only topup_reversal compensating mistaken staff/Mini App wallet topup.';

COMMIT;
