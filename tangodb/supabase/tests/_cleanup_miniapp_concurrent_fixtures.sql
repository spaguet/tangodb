-- Remove committed Mini App concurrent-test fixtures (orgs, fake auth users, helper RPCs).
-- Safe: requires both frozen UUID and exact org name. Never matches real CRM tenants.

DO $$
DECLARE
  rec record;
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname LIKE '%calendar_sync%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', r.table_name, r.trigger_name);
  END LOOP;

  BEGIN
    FOR rec IN
      SELECT x.id, x.name
      FROM (
        VALUES
          ('a0f30000-0000-4000-8000-000000000001'::uuid, 'FA3 Concurrent Org'),
          ('fa700000-0000-4000-8000-000000000001'::uuid, 'FA7 Parallel Topup Org'),
          ('fdb40000-0000-4000-8000-000000000001'::uuid, 'FDB4 Concurrent Org'),
          ('fdb40000-0000-4000-8000-000000000002'::uuid, 'FDB4 Expire Race Org'),
          ('fdb40000-0000-4000-8000-000000000003'::uuid, 'FDB4 Cancel Race Org'),
          ('fdb40000-0000-4000-8000-000000000004'::uuid, 'FDB4 Tail Conflict Org')
      ) AS x(id, name)
      JOIN organizations o ON o.id = x.id AND o.name = x.name
      WHERE o.status IS DISTINCT FROM 'purged'
        AND NOT EXISTS (
          SELECT 1
          FROM auth.users u
          WHERE u.id = o.owner_user_id
            AND lower(coalesce(u.email, '')) IN (
              'albertkoall@gmail.com',
              'spaguet@yandex.ru'
            )
        )
    LOOP
      PERFORM purge_single_organization(
        rec.id,
        NULL,
        'cleanup leftover Mini App concurrent SQL fixtures',
        true
      );
    END LOOP;
  EXCEPTION
    WHEN OTHERS THEN
      FOR r IN
        SELECT c.relname AS table_name, t.tgname AS trigger_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND NOT t.tgisinternal
          AND t.tgname LIKE '%calendar_sync%'
      LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.table_name, r.trigger_name);
      END LOOP;
      RAISE;
  END;

  FOR r IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname LIKE '%calendar_sync%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.table_name, r.trigger_name);
  END LOOP;
END $$;

DO $$
DECLARE
  rec record;
BEGIN
  FOR rec IN
    SELECT u.id
    FROM auth.users u
    WHERE (u.id, u.email) IN (
      ('a0f30000-0000-4000-8000-000000000011'::uuid, 'fa3-concurrent@test.local'),
      ('fa700000-0000-4000-8000-000000000011'::uuid, 'fa7-parallel@test.local'),
      ('fdb40000-0000-4000-8000-000000000011'::uuid, 'fdb4-owner@test.local'),
      ('fdb40000-0000-4000-8000-000000000011'::uuid, 'fdb4-tail@test.local')
    )
  LOOP
    DELETE FROM auth.refresh_tokens WHERE user_id::uuid = rec.id;
    DELETE FROM auth.sessions WHERE user_id::uuid = rec.id;
    DELETE FROM auth.identities WHERE user_id = rec.id;
    DELETE FROM auth.users WHERE id = rec.id;
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        '_hall_rent_test_set_jwt',
        '_test_assert',
        '_test_fa3_hold_wallet_mutate',
        '_test_fa7_parallel_topup_sql',
        '_fdb4_pack_slot',
        '_fdb4_find_pack_monday',
        '_test_fdb4_parallel_pack_create',
        '_test_fdb4_expire_race_hold',
        '_test_fdb4_topup_race',
        '_test_fdb4_topup_race_cancel',
        '_test_fdb4_cancel_race'
      )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', r.sig);
  END LOOP;
END $$;
