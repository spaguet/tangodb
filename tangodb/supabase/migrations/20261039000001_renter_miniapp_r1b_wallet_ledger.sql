-- R1b / 2.9.2: renter wallet ledger, spendable/available helpers, leftover-advance backfill, lock key.
-- Cashier inflow stays rental_advances (no UNION ledger into rental_money_register_v).
-- No create-booking RPC (R1c).

BEGIN;

-- =============================================================================
-- 1. renter_wallet_ledger (no GRANT SELECT authenticated, not Realtime)
-- =============================================================================

CREATE TABLE IF NOT EXISTS renter_wallet_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  renter_id       uuid NOT NULL,
  entry_type      text NOT NULL
    CHECK (entry_type IN (
      'topup',
      'prepay_charge',
      'remainder_charge',
      'refund',
      'debt_settle',
      'surcharge_one_time_recalc'
    )),
  amount          numeric(12, 2) NOT NULL CHECK (amount > 0),
  rental_id       uuid,
  advance_id      uuid,
  phase           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, renter_id)
    REFERENCES renters (organization_id, id),
  FOREIGN KEY (organization_id, rental_id)
    REFERENCES rentals (organization_id, id),
  FOREIGN KEY (organization_id, advance_id)
    REFERENCES rental_advances (organization_id, id),
  CHECK (
    (entry_type = 'topup' AND rental_id IS NULL)
    OR (entry_type <> 'topup')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS renter_wallet_ledger_rental_phase_unique
  ON renter_wallet_ledger (rental_id, phase)
  WHERE rental_id IS NOT NULL AND phase IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS renter_wallet_ledger_topup_advance_unique
  ON renter_wallet_ledger (advance_id)
  WHERE entry_type = 'topup' AND advance_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_renter_wallet_ledger_org_renter
  ON renter_wallet_ledger (organization_id, renter_id, created_at);

COMMENT ON TABLE renter_wallet_ledger IS
  'Mini App wallet movements. topup mirrors rental_advances (cashier inflow); charges/refunds/debt_settle/surcharge are wallet-only, not a second register UNION. Reserved prepay is NOT stored here — derived from rentals.lifecycle=active.';

COMMENT ON COLUMN renter_wallet_ledger.phase IS
  'Slot-phase idempotency; unique with rental_id when both set. NULL on topup.';

ALTER TABLE renter_wallet_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE renter_wallet_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE renter_wallet_ledger TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'renter_wallet_ledger'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.renter_wallet_ledger;
  END IF;
END;
$$;

-- =============================================================================
-- 2. Balance helpers (SQL, not JS). Invariant wallet >= reserved is asserted in R1c apply, not TABLE CHECK.
-- =============================================================================

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

CREATE OR REPLACE FUNCTION _renter_wallet_reserved_prepay(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(r.prepay_amount), 0)::numeric(12, 2)
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp'
    AND r.lifecycle = 'active'
    AND r.prepay_charged_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_debt_outstanding(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(SUM(r.debt_amount), 0)::numeric(12, 2)
  FROM rentals r
  WHERE r.organization_id = p_org_id
    AND r.renter_id = p_renter_id
    AND r.channel = 'miniapp';
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_spendable(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT GREATEST(
    _renter_wallet_balance(p_org_id, p_renter_id)
      - _renter_wallet_reserved_prepay(p_org_id, p_renter_id),
    0
  )::numeric(12, 2);
$$;

CREATE OR REPLACE FUNCTION _renter_wallet_available(p_org_id uuid, p_renter_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN _renter_wallet_debt_outstanding(p_org_id, p_renter_id) > 0 THEN 0::numeric(12, 2)
    ELSE _renter_wallet_spendable(p_org_id, p_renter_id)
  END;
$$;

REVOKE ALL ON FUNCTION _renter_wallet_balance(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_reserved_prepay(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_debt_outstanding(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_spendable(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _renter_wallet_available(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION _renter_wallet_balance(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_reserved_prepay(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_debt_outstanding(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_spendable(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION _renter_wallet_available(uuid, uuid) TO service_role;

COMMENT ON FUNCTION _renter_wallet_balance(uuid, uuid) IS
  'Σ ledger: topup + refund − prepay_charge − remainder_charge − debt_settle − surcharge.';
COMMENT ON FUNCTION _renter_wallet_reserved_prepay(uuid, uuid) IS
  'Σ prepay_amount on Mini App rentals with lifecycle=active AND prepay_charged_at IS NULL.';
COMMENT ON FUNCTION _renter_wallet_spendable(uuid, uuid) IS
  'GREATEST(wallet_balance − reserved_prepay, 0). Never negative.';
COMMENT ON FUNCTION _renter_wallet_available(uuid, uuid) IS
  '0 when Mini App debt_outstanding > 0, else spendable. FIFO activation uses this.';

-- =============================================================================
-- 3. Advisory lock key — md5/bit(60) like location lock, suffix :renter_wallet
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_wallet_lock_key(p_org_id uuid, p_renter_id uuid)
RETURNS bigint
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (
    ('x' || substr(
      md5(p_org_id::text || ':' || p_renter_id::text || ':renter_wallet'),
      1,
      15
    ))::bit(60)::bigint
  );
$$;

REVOKE ALL ON FUNCTION _renter_wallet_lock_key(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_wallet_lock_key(uuid, uuid) TO service_role;

COMMENT ON FUNCTION _renter_wallet_lock_key(uuid, uuid) IS
  'R1b: wallet advisory lock (md5/bit(60), suffix :renter_wallet). Take AFTER sorted _rental_location_lock_key. Do not hashtext(org||renter) — collides with renters_crm :contacts.';

-- =============================================================================
-- 4. Currency guard: also refuse when org has non-zero wallet_balance
-- =============================================================================

CREATE OR REPLACE FUNCTION organization_settings_miniapp_currency_tz_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.currency_code IS DISTINCT FROM NEW.currency_code THEN
    IF EXISTS (
      SELECT 1
      FROM location_rental_hour_rates r
      WHERE r.organization_id = NEW.organization_id
    ) OR EXISTS (
      SELECT 1
      FROM rentals x
      WHERE x.organization_id = NEW.organization_id
        AND x.channel = 'miniapp'
    ) OR EXISTS (
      SELECT 1
      FROM renter_wallet_ledger l
      WHERE l.organization_id = NEW.organization_id
      GROUP BY l.renter_id
      HAVING SUM(
        CASE
          WHEN l.entry_type IN ('topup', 'refund') THEN l.amount
          ELSE -l.amount
        END
      ) <> 0
    ) THEN
      RAISE EXCEPTION 'currency_code cannot change while Mini App rates, slots, or a non-zero wallet exist'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.timezone IS DISTINCT FROM NEW.timezone THEN
    IF EXISTS (
      SELECT 1
      FROM rentals x
      WHERE x.organization_id = NEW.organization_id
        AND x.channel = 'miniapp'
        AND x.lifecycle IN ('awaiting_payment', 'active', 'prepaid_charged')
    ) THEN
      RAISE EXCEPTION 'timezone cannot change while Mini App slots are awaiting_payment/active/prepaid_charged'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- 5. One-shot leftover backfill: remaining advance → ledger topup, then allocated_amount = amount
-- =============================================================================

CREATE OR REPLACE FUNCTION _renter_wallet_backfill_unallocated_advances()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH transferred AS (
    INSERT INTO renter_wallet_ledger (
      organization_id,
      renter_id,
      entry_type,
      amount,
      rental_id,
      advance_id,
      phase
    )
    SELECT
      ra.organization_id,
      ra.renter_id,
      'topup',
      (ra.amount - ra.allocated_amount)::numeric(12, 2),
      NULL,
      ra.id,
      NULL
    FROM rental_advances ra
    WHERE ra.amount > ra.allocated_amount
      AND NOT EXISTS (
        SELECT 1
        FROM renter_wallet_ledger l
        WHERE l.advance_id = ra.id
          AND l.entry_type = 'topup'
      )
    RETURNING advance_id
  ),
  upd AS (
    UPDATE rental_advances ra
    SET allocated_amount = ra.amount
    FROM transferred t
    WHERE ra.id = t.advance_id
    RETURNING ra.id
  )
  SELECT count(*)::integer INTO v_count FROM upd;

  RETURN COALESCE(v_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION _renter_wallet_backfill_unallocated_advances() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _renter_wallet_backfill_unallocated_advances() TO service_role;

COMMENT ON FUNCTION _renter_wallet_backfill_unallocated_advances() IS
  'Transfer leftover (amount − allocated_amount) into wallet topup, then mark advance fully allocated. Idempotent. Does not insert a cashier register row.';

SELECT _renter_wallet_backfill_unallocated_advances();

-- =============================================================================
-- 6. allocate_rental_advance: leftover already in the wallet cannot go to 2.5 invoices
-- =============================================================================

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
  v_wallet_sink numeric;
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

  v_wallet_sink := COALESCE((
    SELECT SUM(l.amount)
    FROM renter_wallet_ledger l
    WHERE l.organization_id = v_org_id
      AND l.advance_id = p_advance_id
      AND l.entry_type = 'topup'
  ), 0);

  -- Wallet-transferred remainder is not allocatable to 2.5 invoices (backfill sink).
  v_available := v_advance.amount - GREATEST(v_advance.allocated_amount, v_wallet_sink);
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

REVOKE ALL ON FUNCTION allocate_rental_advance(uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION allocate_rental_advance(uuid, uuid, numeric) TO authenticated;

COMMIT;
