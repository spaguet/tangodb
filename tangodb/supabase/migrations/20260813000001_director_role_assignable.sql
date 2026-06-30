-- Allow owner to invite and assign director (Руководитель) role.
-- Internal DB role remains `director`; UI label is team.role.director → «Руководитель».

-- Drop invite constraint that blocked owner/director invites (keep owner blocked via new check).
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'organization_invites'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%owner%director%'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%IN (%owner'', ''director'', ''admin%'
  LOOP
    EXECUTE format('ALTER TABLE organization_invites DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE organization_invites
  DROP CONSTRAINT IF EXISTS organization_invites_role_no_owner_invite;

ALTER TABLE organization_invites
  ADD CONSTRAINT organization_invites_role_no_owner_invite
  CHECK (role <> 'owner');

CREATE OR REPLACE FUNCTION inviter_can_assign_role(p_inviter_role text, p_target_role text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_target_role = 'owner' THEN false
    WHEN p_target_role = 'director' THEN p_inviter_role = 'owner'
    WHEN p_inviter_role = 'owner' THEN p_target_role IN ('director', 'admin', 'teacher', 'accountant')
    WHEN p_inviter_role = 'director' THEN p_target_role IN ('admin', 'teacher', 'accountant')
    WHEN p_inviter_role = 'admin' THEN p_target_role IN ('teacher', 'accountant')
    ELSE false
  END;
$$;
