-- A5: crm_staff_push device RPC smoke (run on local test DB after migration).
-- psql $DATABASE_URL -f supabase/tests/crm_staff_push_a5_test.sql

BEGIN;

DO $$
DECLARE
  v_org uuid;
  v_member uuid;
BEGIN
  SELECT o.id, om.id
  INTO v_org, v_member
  FROM organizations o
  JOIN organization_members om ON om.organization_id = o.id
  WHERE om.role = 'teacher'
  LIMIT 1;

  IF v_org IS NULL THEN
    RAISE NOTICE 'Skip: no teacher fixture';
    RETURN;
  END IF;

  IF to_regclass('public.crm_staff_push_devices') IS NULL THEN
    RAISE EXCEPTION 'crm_staff_push_devices missing — apply migration first';
  END IF;

  RAISE NOTICE 'crm_staff_push_a5 schema OK for org %', v_org;
END;
$$;

ROLLBACK;
