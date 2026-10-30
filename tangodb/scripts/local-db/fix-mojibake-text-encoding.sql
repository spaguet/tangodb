-- Legacy one-pass WIN1251 repair (kept for snapshots restored before repair-text-from-snapshot).
-- Prefer repair-text-from-snapshot.mjs from the original UTF-8 pg_dump.

CREATE OR REPLACE FUNCTION pg_temp.local_fix_mojibake_text(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_text IS NULL OR p_text = '' THEN
    RETURN p_text;
  END IF;
  RETURN convert_from(convert_to(p_text, 'WIN1251'), 'UTF8');
EXCEPTION
  WHEN OTHERS THEN
    RETURN p_text;
END;
$$;

DO $$
DECLARE
  r record;
  v_sql text;
BEGIN
  FOR r IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema
     AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type IN ('text', 'character varying')
  LOOP
    v_sql := format(
      'UPDATE %I SET %I = pg_temp.local_fix_mojibake_text(%I)
       WHERE %I IS NOT NULL
         AND strpos(%I, U&''\0098'') = 0
         AND pg_temp.local_fix_mojibake_text(%I) IS DISTINCT FROM %I',
      r.table_name,
      r.column_name,
      r.column_name,
      r.column_name,
      r.column_name,
      r.column_name,
      r.column_name
    );
    EXECUTE v_sql;
  END LOOP;
END;
$$;
