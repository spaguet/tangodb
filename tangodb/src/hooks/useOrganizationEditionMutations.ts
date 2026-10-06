import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { parseOrgEditionRpc, type ProductEdition } from "../lib/orgEdition";
import { orgEditionQueryKey } from "./useOrgEdition";

function mapEditionRpcError(message: string): string {
  if (message.includes("edition_active_above_ceiling")) return "edition_active_above_ceiling";
  if (message.includes("no_live_monthly")) return "no_live_monthly";
  if (message.includes("permission denied")) return "permission_denied";
  return message;
}

export function useSetOrganizationActiveEdition() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (edition: ProductEdition) => {
      const { data, error } = await supabase.rpc("set_organization_active_edition", {
        p_edition: edition,
      });
      if (error) throw new Error(mapEditionRpcError(error.message));
      const lifecycleRes = await supabase.rpc("editions_lifecycle_enabled");
      const lifecycleEnabled = lifecycleRes.data === true;
      return parseOrgEditionRpc(data, lifecycleEnabled);
    },
    onSuccess: async (_data, _edition, _ctx) => {
      await queryClient.invalidateQueries({ queryKey: ["organization-edition"] });
    },
  });
}

export function useCancelOrganizationMonthlyEntitlement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("cancel_organization_monthly_entitlement");
      if (error) throw new Error(mapEditionRpcError(error.message));
      const lifecycleRes = await supabase.rpc("editions_lifecycle_enabled");
      const lifecycleEnabled = lifecycleRes.data === true;
      return parseOrgEditionRpc(data, lifecycleEnabled);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization-edition"] });
    },
  });
}
