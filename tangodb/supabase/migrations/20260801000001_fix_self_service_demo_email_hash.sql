-- Ensure self-service demo email hashing works on hosted Supabase.
-- The Edge Functions now hash email locally, but SQL still validates the hash
-- inside create_self_service_demo_org.

CREATE OR REPLACE FUNCTION owner_email_hash(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT encode(digest(lower(trim(coalesce(p_email, ''))), 'sha256'), 'hex');
$$;

REVOKE ALL ON FUNCTION owner_email_hash(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION owner_email_hash(text) TO service_role;
