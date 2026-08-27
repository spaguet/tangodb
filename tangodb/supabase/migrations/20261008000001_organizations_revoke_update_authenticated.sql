-- S06 / H10: block REST UPDATE on organizations (demo_expires_at, owner_user_id, status, etc.).
-- SPA reads organizations via SELECT only (OrganizationProvider); display name is organization_settings.branding_name.
-- complete_organization_onboarding and license/access-key RPCs are SECURITY DEFINER — unaffected.

REVOKE UPDATE ON organizations FROM anon, authenticated;
