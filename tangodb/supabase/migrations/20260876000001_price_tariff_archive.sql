-- Soft archive for the main price list. Historical sales keep their price_id.

ALTER TABLE public.prices
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- The old schema did not store tariff creation time. For legacy rows use the
-- earliest linked sale when available, otherwise the migration timestamp.
UPDATE public.prices p
SET created_at = COALESCE(
  (
    SELECT min(s.created_at)
    FROM public.subscriptions s
    WHERE s.organization_id = p.organization_id
      AND s.price_id = p.id
  ),
  (
    SELECT min(sv.created_at)
    FROM public.single_visits sv
    WHERE sv.organization_id = p.organization_id
      AND sv.price_id = p.id
  ),
  now()
)
WHERE p.created_at IS NULL;

ALTER TABLE public.prices
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.prices
  DROP CONSTRAINT IF EXISTS prices_status_check,
  DROP CONSTRAINT IF EXISTS prices_archive_consistency_check;

ALTER TABLE public.prices
  ADD CONSTRAINT prices_status_check
    CHECK (status IN ('active', 'archived')),
  ADD CONSTRAINT prices_archive_consistency_check
    CHECK (
      (status = 'active' AND archived_at IS NULL)
      OR (status = 'archived' AND archived_at IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS idx_prices_org_status
  ON public.prices (organization_id, status, created_at DESC);

CREATE OR REPLACE FUNCTION public.list_archived_prices()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_prices jsonb;
BEGIN
  IF v_org_id IS NULL OR NOT can_read_prices() THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      to_jsonb(p)
      || jsonb_build_object(
        'teacher_member_ids',
        COALESCE(
          (
            SELECT jsonb_agg(ptm.member_id ORDER BY ptm.member_id)
            FROM public.price_teacher_members ptm
            WHERE ptm.organization_id = v_org_id
              AND ptm.price_id = p.id
          ),
          '[]'::jsonb
        ),
        'sales_count',
        (
          SELECT count(*)
          FROM public.subscriptions s
          WHERE s.organization_id = v_org_id
            AND s.price_id = p.id
        )
        +
        (
          SELECT count(*)
          FROM public.single_visits sv
          WHERE sv.organization_id = v_org_id
            AND sv.price_id = p.id
        )
      )
      ORDER BY p.archived_at DESC, p.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_prices
  FROM public.prices p
  WHERE p.organization_id = v_org_id
    AND p.status = 'archived';

  RETURN jsonb_build_object('success', true, 'prices', v_prices);
END;
$$;

REVOKE ALL ON FUNCTION public.list_archived_prices() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_archived_prices() TO authenticated, service_role;
