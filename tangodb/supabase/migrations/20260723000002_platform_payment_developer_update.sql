-- Dev Console: allow platform developers to update public payment config (singleton row)

CREATE OR REPLACE FUNCTION is_dev_console_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT (u.raw_app_meta_data ->> 'platform_role') = 'developer'
      FROM auth.users u
      WHERE u.id = auth.uid()
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION is_dev_console_operator() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_dev_console_operator() TO authenticated;

CREATE POLICY platform_payment_methods_update_developer
  ON platform_payment_methods
  FOR UPDATE
  TO authenticated
  USING (is_dev_console_operator())
  WITH CHECK (is_dev_console_operator());

GRANT UPDATE (config, updated_at, updated_by) ON platform_payment_methods TO authenticated;
