-- Teachers with CRM scope need read-only access to prices when selling subscriptions
-- or private lessons. Write remains owner/director via can_manage_prices().

BEGIN;

CREATE OR REPLACE FUNCTION can_read_prices()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, auth
AS $$
  SELECT current_member_role() IN ('owner', 'director', 'admin', 'accountant')
    OR (
      current_member_role() = 'teacher'
      AND teacher_has_any_scope()
    );
$$;

COMMIT;
