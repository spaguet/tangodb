-- S38 / L20: defense-in-depth search_path on SECURITY DEFINER functions that
-- do not already set it. extra_search_path no longer includes `extensions`.

BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT
      n.nspname AS schema_name,
      p.proname AS func_name,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE p.prosecdef
      AND n.nspname = 'public'
      AND (
        p.proconfig IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS c(cfg)
          WHERE c.cfg LIKE 'search_path=%'
        )
      )
  LOOP
    EXECUTE format(
      'ALTER FUNCTION %I.%I(%s) SET search_path = public, auth',
      r.schema_name,
      r.func_name,
      r.args
    );
  END LOOP;
END $$;

COMMIT;
