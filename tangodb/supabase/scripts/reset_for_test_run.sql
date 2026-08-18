-- Reset TangoDB for fresh test run. Keeps platform developer admin by email.
-- Default admin: albertkoall@gmail.com

DO $$
DECLARE
  v_admin_email text := 'albertkoall@gmail.com';
  v_admin_id uuid;
  v_org_id uuid;
  r record;
BEGIN
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE lower(email) = lower(trim(v_admin_email))
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Admin user % not found', v_admin_email;
  END IF;

  RAISE NOTICE 'Keeping admin % (%)', v_admin_email, v_admin_id;

  -- Disable row audit triggers (safe if trigger already missing)
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

  DELETE FROM audit_log;
  DELETE FROM user_active_organizations;

  UPDATE organizations SET access_key_id = NULL;
  UPDATE access_keys SET organization_id = NULL;

  DELETE FROM organizations;

  DELETE FROM access_keys;
  DELETE FROM demo_owner_retention;
  DELETE FROM self_service_demo_challenges;
  DELETE FROM user_recovery_codes;
  DELETE FROM platform_waitlist;
  DELETE FROM organization_invites;
  DELETE FROM organization_version_migrations;
  DELETE FROM platform_org_notes;
  DELETE FROM billing_webhook_events;
  DELETE FROM platform_audit_log;
  DELETE FROM allowed_users;

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

  DELETE FROM auth.refresh_tokens WHERE user_id::uuid <> v_admin_id;
  DELETE FROM auth.sessions WHERE user_id::uuid <> v_admin_id;
  DELETE FROM auth.identities WHERE user_id <> v_admin_id;
  DELETE FROM auth.users WHERE id <> v_admin_id;

  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"platform_role":"developer"}'::jsonb
  WHERE id = v_admin_id;

  RAISE NOTICE 'Reset complete. Admin preserved: %', v_admin_email;
END $$;
