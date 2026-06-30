-- Fix org purge: CASCADE DELETE fires audit triggers that INSERT into audit_log
-- while organizations row is already gone → FK violation (audit_log_organization_id_fkey).
-- Same pattern as supabase/scripts/reset_for_test_run.sql.

CREATE OR REPLACE FUNCTION _purge_demo_organization_core(
  p_org_id uuid,
  p_actor_user_id uuid DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_force_licensed boolean DEFAULT false,
  p_audit_action text DEFAULT 'org.purged'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_org record;
  v_key_id uuid;
  v_has_lifetime boolean := false;
  v_has_active_sub boolean := false;
  v_owner_email text;
  v_tg_id text;
  v_email_hash text;
  v_tg_hash text;
  v_prev_name text;
  v_prev_status text;
  r record;
BEGIN
  SELECT o.id, o.access_key_id, o.name, o.status, o.owner_user_id,
         o.demo_activated_at, o.payment_ref
  INTO v_org
  FROM organizations o
  WHERE o.id = p_org_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'organization_not_found' USING ERRCODE = '22023';
  END IF;

  IF v_org.status = 'purged' THEN
    RAISE EXCEPTION 'organization_already_purged' USING ERRCODE = '22023';
  END IF;

  SELECT organization_has_lifetime_license(p_org_id) INTO v_has_lifetime;

  IF v_has_lifetime AND NOT coalesce(p_force_licensed, false) THEN
    RAISE EXCEPTION 'licensed_org_purge_forbidden' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM organization_subscriptions os
    WHERE os.organization_id = p_org_id
      AND os.status IN ('active', 'past_due')
  ) INTO v_has_active_sub;

  IF v_has_active_sub AND NOT coalesce(p_force_licensed, false) THEN
    RAISE EXCEPTION 'active_subscription_purge_forbidden' USING ERRCODE = '22023';
  END IF;

  v_prev_name := v_org.name;
  v_prev_status := v_org.status;
  v_key_id := v_org.access_key_id;

  IF v_org.owner_user_id IS NOT NULL THEN
    SELECT u.email, u.raw_app_meta_data ->> 'telegram_id'
    INTO v_owner_email, v_tg_id
    FROM auth.users u
    WHERE u.id = v_org.owner_user_id;

    IF v_owner_email IS NOT NULL AND trim(v_owner_email) <> '' THEN
      v_email_hash := owner_email_hash(v_owner_email);
    END IF;

    IF v_tg_id IS NOT NULL AND trim(v_tg_id) <> '' THEN
      v_tg_hash := telegram_id_hash(v_tg_id);
    END IF;

    IF v_email_hash IS NOT NULL THEN
      INSERT INTO demo_owner_retention (
        owner_email_hash,
        telegram_id_hash,
        first_demo_at,
        purged_at,
        payment_ref
      )
      VALUES (
        v_email_hash,
        v_tg_hash,
        coalesce(v_org.demo_activated_at, now()),
        now(),
        v_org.payment_ref
      )
      ON CONFLICT (owner_email_hash) DO UPDATE
        SET purged_at = EXCLUDED.purged_at,
            telegram_id_hash = coalesce(EXCLUDED.telegram_id_hash, demo_owner_retention.telegram_id_hash),
            payment_ref = coalesce(EXCLUDED.payment_ref, demo_owner_retention.payment_ref);
    END IF;
  END IF;

  DELETE FROM user_active_organizations uao
  WHERE uao.organization_id = p_org_id;

  UPDATE organizations
  SET access_key_id = NULL
  WHERE id = p_org_id;

  UPDATE access_keys
  SET status = 'consumed', organization_id = NULL
  WHERE organization_id = p_org_id
     OR (v_key_id IS NOT NULL AND id = v_key_id);

  FOR r IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname LIKE 'audit_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', r.table_name, r.trigger_name);
  END LOOP;

  DELETE FROM organizations
  WHERE id = p_org_id;

  FOR r IN
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname LIKE 'audit_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER %I', r.table_name, r.trigger_name);
  END LOOP;

  INSERT INTO platform_audit_log (actor_user_id, action, target_type, target_id, metadata)
  VALUES (
    p_actor_user_id,
    p_audit_action,
    'organization',
    p_org_id,
    jsonb_build_object(
      'previous_name', v_prev_name,
      'previous_status', v_prev_status,
      'reason', left(coalesce(p_reason, ''), 500),
      'force_licensed', coalesce(p_force_licensed, false),
      'deleted', true
    )
  );

  RETURN jsonb_build_object('ok', true, 'organization_id', p_org_id, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION _purge_demo_organization_core(uuid, uuid, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION _purge_demo_organization_core(uuid, uuid, text, boolean, text) TO service_role;
