import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  formatCurrency,
  formatOptionsFromSettings,
  setActiveFormatOptions,
} from "../lib/format";
import {
  freezePolicyFromSettings,
  type FreezePolicy,
} from "../lib/freezePolicy";
import { supabase } from "../lib/supabase";
import type { OrganizationSettings } from "../types/organization";

export const organizationSettingsQueryKey = ["organization-settings"] as const;

type SettingsPatch = Partial<
  Omit<OrganizationSettings, "organization_id" | "updated_at">
>;

interface SettingsContextValue {
  settings: OrganizationSettings | null;
  isLoading: boolean;
  freezePolicy: FreezePolicy;
  formatCurrency: (amount: number) => string;
  updateSettings: (patch: SettingsPatch) => Promise<{ success: boolean; error?: string }>;
  isUpdating: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { organizationId, settings, orgLoading, refreshOrganization } = useOrganization();

  const formatOpts = useMemo(() => formatOptionsFromSettings(settings), [settings]);
  const freezePolicy = useMemo(() => freezePolicyFromSettings(settings), [settings]);

  useEffect(() => {
    setActiveFormatOptions(formatOpts);
  }, [formatOpts]);

  const boundFormatCurrency = useCallback(
    (amount: number) => formatCurrency(amount, formatOpts),
    [formatOpts]
  );

  const updateMutation = useMutation({
    mutationFn: async (patch: SettingsPatch) => {
      if (!organizationId) {
        return { success: false as const, error: "Организация не выбрана" };
      }

      const { error } = await supabase
        .from("organization_settings")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("organization_id", organizationId);

      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: organizationSettingsQueryKey });
        void queryClient.invalidateQueries({ queryKey: ["organization-context"] });
        void refreshOrganization();
      }
    },
  });

  const updateSettings = useCallback(
    async (patch: SettingsPatch) => updateMutation.mutateAsync(patch),
    [updateMutation]
  );

  const value = useMemo(
    () => ({
      settings,
      isLoading: orgLoading,
      freezePolicy,
      formatCurrency: boundFormatCurrency,
      updateSettings,
      isUpdating: updateMutation.isPending,
    }),
    [settings, orgLoading, freezePolicy, boundFormatCurrency, updateSettings, updateMutation.isPending]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
