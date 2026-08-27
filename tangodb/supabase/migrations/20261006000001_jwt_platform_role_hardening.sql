-- H33 / S04: do not copy platform_role into CRM JWT; lock platform tables to service_role.

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  claims jsonb;
  tgid text;
  v_user_id uuid;
  v_org_id uuid;
  v_member_id uuid;
  v_role text;
BEGIN
  claims := event -> 'claims';
  v_user_id := (claims ->> 'sub')::uuid;

  tgid := claims -> 'app_metadata' ->> 'telegram_id';
  IF tgid IS NOT NULL AND tgid <> '' THEN
    claims := jsonb_set(claims, '{telegram_id}', to_jsonb(tgid));
  END IF;

  SELECT uao.organization_id, uao.member_id, om.role
  INTO v_org_id, v_member_id, v_role
  FROM user_active_organizations uao
  JOIN organization_members om ON om.id = uao.member_id
  WHERE uao.user_id = v_user_id
    AND om.is_active = true;

  IF v_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{organization_id}', to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{member_id}', to_jsonb(v_member_id::text));
    claims := jsonb_set(claims, '{member_role}', to_jsonb(v_role));
  END IF;

  RETURN jsonb_build_object('claims', claims);
END;
$$;

DROP POLICY IF EXISTS crm_product_versions_write_developer ON crm_product_versions;
CREATE POLICY crm_product_versions_write_denied_authenticated
  ON crm_product_versions
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS platform_audit_log_developer ON platform_audit_log;
CREATE POLICY platform_audit_log_denied_authenticated
  ON platform_audit_log
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS organization_version_migrations_select_developer
  ON organization_version_migrations;

DROP POLICY IF EXISTS platform_payment_methods_update_developer
  ON platform_payment_methods;

REVOKE ALL ON platform_audit_log FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON crm_product_versions FROM anon, authenticated;
REVOKE UPDATE ON platform_payment_methods FROM anon, authenticated;
