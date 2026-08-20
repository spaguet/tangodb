import { useCallback } from "react";
import { useOrganization } from "../organization/OrganizationProvider";

export function useOrgQueryScope() {
  const { organizationId, orgLoading } = useOrganization();

  const withOrgId = useCallback(
    <T extends readonly unknown[]>(base: T) => {
      return (organizationId ? [...base, organizationId] : base) as readonly unknown[];
    },
    [organizationId]
  );

  return {
    organizationId,
    enabled: !!organizationId && !orgLoading,
    withOrgId,
  };
}
