import { useMutation } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import type { OrgModules, OrgPreset } from "../types/organization";

export interface CompleteOrganizationOnboardingInput {
  organizationId: string;
  name: string;
  orgPreset: OrgPreset;
  locale: string;
  currencyCode: string;
  modules: OrgModules;
}

export function useCompleteOrganizationOnboarding() {
  return useMutation({
    mutationFn: async (input: CompleteOrganizationOnboardingInput) => {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      const { data, error: rpcError } = await supabase.rpc("complete_organization_onboarding", {
        p_organization_id: input.organizationId,
        p_name: input.name,
        p_org_preset: input.orgPreset,
        p_locale: input.locale,
        p_currency_code: input.currencyCode,
        p_modules: asJson(input.modules),
        p_pair_cycle_enabled: false,
      });

      if (rpcError) throw rpcError;
      if (!data || (data as { ok?: boolean }).ok !== true) {
        throw new Error("onboarding_save_failed");
      }

      const { error: postRefreshError } = await supabase.auth.refreshSession();
      if (postRefreshError) throw postRefreshError;

      return data as { ok: boolean };
    },
  });
}
