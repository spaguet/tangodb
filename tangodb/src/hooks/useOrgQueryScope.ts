import { useOrganization } from "../organization/OrganizationProvider";

export function useOrgQueryScope() {
  const { organizationId } = useOrganization();

  function withOrgId<T extends readonly unknown[]>(base: T) {
    return (organizationId ? [...base, organizationId] : base) as readonly unknown[];
  }

  return {
    organizationId,
    enabled: !!organizationId,
    withOrgId,
  };
}
