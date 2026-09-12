-- S3a / 2.11.5: suspended org shell + license/subscription recovery SELECT (§8.51).

BEGIN;

DROP POLICY IF EXISTS organizations_select_member ON organizations;

CREATE POLICY organizations_select_member
  ON organizations FOR SELECT
  TO authenticated
  USING (
    is_active_member(auth.uid(), id)
    AND (
      organization_allows_reads(id)
      OR status = 'suspended'
    )
  );

DROP POLICY IF EXISTS organization_licenses_select_member ON organization_licenses;

CREATE POLICY organization_licenses_select_member
  ON organization_licenses FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND (
      organization_allows_reads(organization_id)
      OR (
        EXISTS (
          SELECT 1
          FROM organizations o
          WHERE o.id = organization_id
            AND o.status = 'suspended'
        )
        AND member_role(auth.uid(), organization_id) IN ('owner', 'director')
      )
    )
  );

DROP POLICY IF EXISTS organization_subscriptions_select_member ON organization_subscriptions;

CREATE POLICY organization_subscriptions_select_member
  ON organization_subscriptions FOR SELECT
  TO authenticated
  USING (
    organization_id = auth_organization_id()
    AND is_active_member(auth.uid(), organization_id)
    AND (
      organization_allows_reads(organization_id)
      OR (
        EXISTS (
          SELECT 1
          FROM organizations o
          WHERE o.id = organization_id
            AND o.status = 'suspended'
        )
        AND member_role(auth.uid(), organization_id) IN ('owner', 'director')
      )
    )
  );

COMMIT;
