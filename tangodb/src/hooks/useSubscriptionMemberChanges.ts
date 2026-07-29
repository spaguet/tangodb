import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { SubscriptionMemberChange, SubscriptionMemberChangeStatus } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { subscriptionsQueryKey } from "./useSubscriptions";
import { attendanceQueryKey } from "./useAttendance";
import { groupCapacityQueryKey } from "./useGroupCapacity";

export const subscriptionMemberChangesQueryKey = ["subscription-member-changes"] as const;

const mapMemberChange = (row: Record<string, unknown>): SubscriptionMemberChange => ({
  id: String(row.id),
  subscriptionId: String(row.subscription_id),
  memberSlot: Number(row.member_slot),
  outgoingClientId: String(row.outgoing_client_id),
  incomingClientId: String(row.incoming_client_id),
  effectiveDate: String(row.effective_date ?? "").slice(0, 10),
  status: row.status as SubscriptionMemberChangeStatus,
  reason: row.reason != null ? String(row.reason) : null,
  createdAt: String(row.created_at ?? ""),
  appliedAt: row.applied_at != null ? String(row.applied_at) : null,
});

export function useSubscriptionMemberChanges(subscriptionId?: string | null) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...subscriptionMemberChangesQueryKey, subscriptionId ?? "all"]),
    enabled: enabled && Boolean(subscriptionId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_member_changes")
        .select("*")
        .eq("subscription_id", subscriptionId!)
        .order("effective_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => mapMemberChange(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useClientSubscriptionMemberChanges(clientId?: string) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...subscriptionMemberChangesQueryKey, "client", clientId ?? "none"]),
    enabled: enabled && Boolean(clientId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_member_changes")
        .select("*")
        .or(`outgoing_client_id.eq.${clientId},incoming_client_id.eq.${clientId}`)
        .order("effective_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => mapMemberChange(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useReplaceSubscriptionPartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      subscriptionId: string;
      outgoingClientId: string;
      incomingClientId: string;
      effectiveDate: string;
      reason?: string;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("replace_subscription_partner", {
        p_sub_id: payload.subscriptionId,
        p_outgoing_client_id: payload.outgoingClientId,
        p_incoming_client_id: payload.incomingClientId,
        p_effective_date: payload.effectiveDate,
        p_reason: payload.reason?.trim() || null,
        p_idempotency_key: payload.idempotencyKey ?? crypto.randomUUID(),
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        changeId?: string;
        status?: SubscriptionMemberChangeStatus;
        idempotent?: boolean;
      } | null;

      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "subscriptions.partnerReplace.error.failed",
        };
      }

      return {
        success: true as const,
        changeId: result.changeId,
        status: result.status,
        idempotent: result.idempotent ?? false,
      };
    },
    onSuccess: (result) => {
      if (!result.success) return;
      void queryClient.invalidateQueries({ queryKey: subscriptionMemberChangesQueryKey });
      void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
      void queryClient.invalidateQueries({ queryKey: groupCapacityQueryKey });
    },
  });
}
