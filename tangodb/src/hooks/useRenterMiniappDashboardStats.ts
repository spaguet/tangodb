import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const renterMiniappDashboardQueryKey = ["renterMiniappDashboard"] as const;

export interface RenterMiniappDashboardStats {
  yearMonth: string;
  addonActive: boolean;
  revenue: number;
  occupancySlots: number;
  pendingCount: number;
  pendingSlaBreached: number;
  debtTotal: number;
  expiringHolds: number;
  topupSubmitted: number;
  topupConfirmed: number;
  topupRejected: number;
  topupConversionRate: number | null;
}

function mapStats(payload: Record<string, unknown>): RenterMiniappDashboardStats {
  const mini = (payload.miniapp ?? {}) as Record<string, unknown>;
  return {
    yearMonth: String(payload.year_month ?? ""),
    addonActive: Boolean(payload.addon_active),
    revenue: Number(mini.revenue) || 0,
    occupancySlots: Number(mini.occupancy_slots) || 0,
    pendingCount: Number(mini.pending_count) || 0,
    pendingSlaBreached: Number(mini.pending_sla_breached) || 0,
    debtTotal: Number(mini.debt_total) || 0,
    expiringHolds: Number(mini.expiring_holds) || 0,
    topupSubmitted: Number(mini.topup_submitted) || 0,
    topupConfirmed: Number(mini.topup_confirmed) || 0,
    topupRejected: Number(mini.topup_rejected) || 0,
    topupConversionRate:
      mini.topup_conversion_rate != null ? Number(mini.topup_conversion_rate) : null,
  };
}

export function useRenterMiniappDashboardStats(yearMonth: string, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && enabled && Boolean(yearMonth);

  return useQuery({
    queryKey: withOrgId([...renterMiniappDashboardQueryKey, yearMonth]),
    enabled: queryEnabled,
    staleTime: 60 * 1000,
    refetchInterval: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_renter_miniapp_dashboard_stats", {
        p_year_month: yearMonth,
      });
      if (error) throw error;
      const payload = data as { success?: boolean; error?: string } & Record<string, unknown>;
      if (!payload?.success) {
        throw new Error(payload?.error ?? "dashboard.hallRental.error.loadFailed");
      }
      return mapStats(payload);
    },
  });
}
