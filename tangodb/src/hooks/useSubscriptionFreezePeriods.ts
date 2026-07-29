import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { SubscriptionFreezePeriod } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { subscriptionsQueryKey } from "./useSubscriptions";
import { attendanceQueryKey } from "./useAttendance";

export const subscriptionFreezePeriodsQueryKey = ["subscription-freeze-periods"] as const;

const mapFreezePeriod = (row: Record<string, unknown>): SubscriptionFreezePeriod => ({
  id: String(row.id),
  subscriptionId: String(row.subscription_id),
  startDate: String(row.start_date ?? "").slice(0, 10),
  endDate: String(row.end_date ?? "").slice(0, 10),
  reason: row.reason != null ? String(row.reason) : null,
  status: row.status as SubscriptionFreezePeriod["status"],
  calendarDays: Number(row.calendar_days ?? 0),
  expiresDaysAdded: Number(row.expires_days_added ?? 0),
  createdAt: String(row.created_at ?? ""),
  cancelledAt: row.cancelled_at != null ? String(row.cancelled_at) : null,
});

export function useSubscriptionFreezePeriods(subscriptionId?: string | null) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...subscriptionFreezePeriodsQueryKey, subscriptionId ?? "all"]),
    enabled: enabled && Boolean(subscriptionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_freeze_periods")
        .select("*")
        .eq("subscription_id", subscriptionId!)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => mapFreezePeriod(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useApplySubscriptionFreezePeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      subscriptionId: string;
      startDate: string;
      endDate: string;
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc("apply_subscription_freeze_period", {
        p_sub_id: payload.subscriptionId,
        p_start_date: payload.startDate,
        p_end_date: payload.endDate,
        p_reason: payload.reason?.trim() || null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        periodId?: string;
        lessonsLeft?: number;
        expiresAt?: string;
        freezeUsed?: number;
        calendarDays?: number;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "freeze.error.applyFailed" };
      }

      return {
        success: true as const,
        periodId: result.periodId,
        lessonsLeft: result.lessonsLeft,
        expiresAt: result.expiresAt != null ? String(result.expiresAt).slice(0, 10) : null,
        freezeUsed: result.freezeUsed,
        calendarDays: result.calendarDays,
      };
    },
    onSuccess: (result) => {
      if (!result.success) return;
      void queryClient.invalidateQueries({ queryKey: subscriptionFreezePeriodsQueryKey });
      void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
    },
  });
}

export function useCancelSubscriptionFreezePeriod() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (periodId: string) => {
      const { data, error } = await supabase.rpc("cancel_subscription_freeze_period", {
        p_period_id: periodId,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "freeze.error.cancelFailed" };
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (!result.success) return;
      void queryClient.invalidateQueries({ queryKey: subscriptionFreezePeriodsQueryKey });
      void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
    },
  });
}
