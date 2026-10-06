import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useOrganization } from "../organization/OrganizationProvider";
import { supabase } from "../lib/supabase";
import {
  editionAllows,
  parseOrgEditionRpc,
  type EditionCapability,
  type OrgEditionSnapshot,
  type ProductEdition,
} from "../lib/orgEdition";

export const orgEditionQueryKey = (organizationId: string | null) =>
  ["organization-edition", organizationId] as const;

export function useOrgEdition() {
  const { organizationId } = useOrganization();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: orgEditionQueryKey(organizationId),
    enabled: !!organizationId,
    queryFn: async () => {
      const [editionRes, lifecycleRes] = await Promise.all([
        supabase.rpc("get_organization_edition"),
        supabase.rpc("editions_lifecycle_enabled"),
      ]);
      if (editionRes.error) throw editionRes.error;
      if (lifecycleRes.error) throw lifecycleRes.error;
      const lifecycleEnabled = lifecycleRes.data === true;
      return parseOrgEditionRpc(editionRes.data, lifecycleEnabled);
    },
    staleTime: 30_000,
  });

  const snapshot = data ?? null;

  const allows = useMemo(
    () => (capability: EditionCapability) => editionAllows(snapshot, capability),
    [snapshot]
  );

  return {
    edition: snapshot,
    editionLoading: isLoading,
    editionError: isError,
    refreshEdition: refetch,
    lifecycleEnabled: snapshot?.lifecycleEnabled ?? false,
    activeEdition: (snapshot?.activeEdition ?? "lite") as ProductEdition,
    editionAllows: allows,
  };
}

export type { OrgEditionSnapshot };
