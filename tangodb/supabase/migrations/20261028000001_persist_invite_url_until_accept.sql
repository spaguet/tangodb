-- Persist invite URL for team managers until accept or revoke.
-- View stays can_manage_team-only (M25: no token_hash; no base-table SELECT).

BEGIN;

ALTER TABLE organization_invites
  ADD COLUMN IF NOT EXISTS invite_url text;

CREATE OR REPLACE FUNCTION organization_invites_clear_url_on_close()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.accepted_at IS NOT NULL OR NEW.revoked_at IS NOT NULL THEN
    NEW.invite_url := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_invites_clear_url_on_close ON organization_invites;

CREATE TRIGGER organization_invites_clear_url_on_close
  BEFORE UPDATE ON organization_invites
  FOR EACH ROW
  EXECUTE FUNCTION organization_invites_clear_url_on_close();

DROP VIEW IF EXISTS organization_invites_team_v;

CREATE VIEW organization_invites_team_v
WITH (security_invoker = false) AS
SELECT
  oi.id,
  oi.organization_id,
  oi.email,
  oi.first_name,
  oi.last_name,
  oi.role,
  oi.scope,
  oi.meta,
  oi.expires_at,
  oi.accepted_at,
  oi.revoked_at,
  oi.created_at,
  oi.invited_by,
  oi.invite_url
FROM organization_invites oi
WHERE oi.organization_id = auth_organization_id()
  AND can_manage_team()
  AND organization_allows_reads(oi.organization_id);

REVOKE SELECT ON organization_invites FROM authenticated;
GRANT SELECT ON organization_invites_team_v TO authenticated;

DROP FUNCTION IF EXISTS create_organization_invite(text, text, jsonb, text, jsonb, text, text);

CREATE FUNCTION create_organization_invite(
  p_email text,
  p_role text,
  p_scope jsonb DEFAULT NULL,
  p_token_hash text DEFAULT NULL,
  p_meta jsonb DEFAULT NULL,
  p_first_name text DEFAULT NULL,
  p_last_name text DEFAULT NULL,
  p_invite_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_id uuid := auth_organization_id();
  v_inviter_id uuid := auth_member_id();
  v_inviter_role text;
  v_invite_id uuid;
  v_scope jsonb;
  v_meta jsonb;
  v_email text;
  v_first_name text;
  v_last_name text;
  v_invite_url text;
BEGIN
  IF v_org_id IS NULL OR v_inviter_id IS NULL THEN
    RAISE EXCEPTION 'no active organization';
  END IF;

  IF is_restricted_admin()
    OR NOT can_manage_team()
    OR NOT organization_allows_writes(v_org_id)
  THEN
    RAISE EXCEPTION 'permission denied';
  END IF;

  v_inviter_role := member_role(auth.uid(), v_org_id);
  v_email := lower(trim(p_email));
  v_first_name := nullif(trim(p_first_name), '');
  v_last_name := nullif(trim(p_last_name), '');
  v_invite_url := nullif(trim(p_invite_url), '');

  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RAISE EXCEPTION 'invalid email';
  END IF;

  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'first and last name required';
  END IF;

  IF NOT inviter_can_assign_role(v_inviter_role, p_role) THEN
    RAISE EXCEPTION 'cannot assign this role';
  END IF;

  IF p_role = 'director' AND organization_director_slot_taken(v_org_id) THEN
    RAISE EXCEPTION 'director_slot_taken';
  END IF;

  IF p_token_hash IS NULL OR length(p_token_hash) < 32 THEN
    RAISE EXCEPTION 'invalid token';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_members om
    JOIN auth.users u ON u.id = om.user_id
    WHERE om.organization_id = v_org_id
      AND om.is_active = true
      AND lower(u.email) = v_email
  ) THEN
    RAISE EXCEPTION 'user already a member';
  END IF;

  IF EXISTS (
    SELECT 1 FROM organization_invites oi
    WHERE oi.organization_id = v_org_id
      AND lower(oi.email) = v_email
      AND oi.accepted_at IS NULL
      AND oi.revoked_at IS NULL
      AND oi.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'pending invite already exists';
  END IF;

  v_scope := normalize_member_scope(
    COALESCE(
      p_scope,
      CASE
        WHEN p_role = 'teacher' THEN default_teacher_scope()
        ELSE '{
          "discipline_ids": [],
          "location_ids": [],
          "schedule_group_ids": [],
          "all_disciplines": false,
          "all_locations": false,
          "all_groups": false,
          "can_view_all_clients": false
        }'::jsonb
      END
    ),
    p_role
  );

  IF v_inviter_role IN ('owner', 'director') THEN
    v_meta := normalize_member_meta(COALESCE(p_meta, '{}'::jsonb), p_role);
  ELSE
    v_meta := '{}'::jsonb;
  END IF;

  INSERT INTO organization_invites (
    organization_id, email, role, scope, meta, first_name, last_name,
    token_hash, invite_url, invited_by, expires_at
  )
  VALUES (
    v_org_id, v_email, p_role, v_scope, v_meta, v_first_name, v_last_name,
    p_token_hash, v_invite_url, v_inviter_id, now() + interval '7 days'
  )
  RETURNING id INTO v_invite_id;

  RETURN jsonb_build_object(
    'invite_id', v_invite_id,
    'email', v_email,
    'role', p_role,
    'expires_at', (now() + interval '7 days')
  );
END;
$$;

REVOKE ALL ON FUNCTION create_organization_invite(text, text, jsonb, text, jsonb, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_organization_invite(text, text, jsonb, text, jsonb, text, text, text)
  TO authenticated;

COMMIT;
