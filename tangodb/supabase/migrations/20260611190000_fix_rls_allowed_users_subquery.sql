-- allowed_users has RLS but no SELECT policy for authenticated users,
-- so subqueries in CRM policies always return empty. Use SECURITY DEFINER helper.

CREATE OR REPLACE FUNCTION public.is_allowed_teacher() RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.allowed_users
    WHERE telegram_id = auth_telegram_id() AND is_active
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.is_allowed_teacher() TO authenticated;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients','schedule','prices','subscriptions','attendance','personal_lessons']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "teacher_select" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "teacher_select" ON %I FOR SELECT USING (is_allowed_teacher())',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "teacher_insert" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "teacher_insert" ON %I FOR INSERT WITH CHECK (is_allowed_teacher())',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "teacher_update" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "teacher_update" ON %I FOR UPDATE USING (is_allowed_teacher()) WITH CHECK (is_allowed_teacher())',
      t
    );

    EXECUTE format('DROP POLICY IF EXISTS "teacher_delete" ON %I', t);
    EXECUTE format(
      'CREATE POLICY "teacher_delete" ON %I FOR DELETE USING (is_allowed_teacher())',
      t
    );
  END LOOP;
END $$;
