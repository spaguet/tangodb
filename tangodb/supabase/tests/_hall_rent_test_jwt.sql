-- Shared JWT context for hall-rent SQL regression tests.
-- Include via: psql ... -f supabase/tests/_hall_rent_test_jwt.sql -f supabase/tests/<test>.sql
-- Supabase CLI: run this file before each test file in integration script.

CREATE OR REPLACE FUNCTION _hall_rent_test_set_jwt(
  p_user uuid,
  p_org uuid,
  p_member uuid,
  p_role text DEFAULT 'owner'
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object(
      'sub', p_user::text,
      'organization_id', p_org::text,
      'member_id', p_member::text,
      'role', p_role
    )::text,
    true
  );
  PERFORM set_active_organization(p_org);
END;
$$;
