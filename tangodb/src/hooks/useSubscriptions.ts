import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  computeMonthlyExpiresAt,
  formatClientName,
  normalizeSubscriptionPairMonth,
} from "../lib/utils";
import type { ActiveSubscription, BillingModel, Subscription } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { isRestrictedReceptionAdmin } from "../lib/permissions";
import { useClientDirectory } from "./useClients";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { subscriptionGroupsQueryKey } from "./useSubscriptionGroups";
import { groupCapacityQueryKey } from "./useGroupCapacity";
import { groupSpotNotificationsQueryKey, groupWaitlistQueryKey } from "./useGroupWaitlist";

export const subscriptionsQueryKey = ["subscriptions"] as const;

const mapSubscription = (row: Record<string, unknown>, maskFinancial: boolean): Subscription => ({
  id: row.id as string,
  type: row.type as string,
  clientId1: row.client_id1 as string,
  clientId2: (row.client_id2 as string) || "",
  clientId3: (row.client_id3 as string) || "",
  clientId4: (row.client_id4 as string) || undefined,
  lessonsTotal: row.lessons_total as number,
  lessonsLeft: row.lessons_left as number,
  freezeUsed: row.freeze_used as number,
  activationDate: String(row.activation_date ?? "").slice(0, 10),
  status: row.status as "active" | "finished",
  pairMonth: row.pair_month != null && row.pair_month !== "" ? String(row.pair_month) : "",
  disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
  priceId: maskFinancial
    ? null
    : row.price_id != null
      ? String(row.price_id)
      : null,
  category: (row.category as "group" | "private") || "group",
  billingModel: (row.billing_model as BillingModel) || "lesson_count",
  expiresAt: row.expires_at != null ? String(row.expires_at).slice(0, 10) : null,
});

export function useSubscriptions(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role, membership } = useOrganization();
  const maskFinancial =
    role === "teacher" ||
    isRestrictedReceptionAdmin(role, { restrictedAdmin: membership?.meta?.restricted_admin });
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...subscriptionsQueryKey, { maskFinancial }]),
    enabled: queryEnabled,
    queryFn: async () => {
      const table = maskFinancial ? "subscriptions_teacher_v" : "subscriptions";
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .order("activation_date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) =>
        mapSubscription(row as unknown as Record<string, unknown>, maskFinancial)
      );
    },
    staleTime: 30 * 1000,
  });
}

export function useActiveSubscriptions() {
  const subscriptionsQuery = useSubscriptions();
  const clientsQuery = useClientDirectory();

  const data = useMemo((): ActiveSubscription[] => {
    const subscriptions = subscriptionsQuery.data ?? [];
    const clients = clientsQuery.data ?? [];
    const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));

    return subscriptions
      .filter((s) => s.status === "active")
      .map((s) => {
        const c1 = clientMap[s.clientId1];
        const c2 = s.clientId2 ? clientMap[s.clientId2] : null;
        const c3 = s.clientId3 ? clientMap[s.clientId3] : null;

        return {
          subId: s.id,
          type: s.type,
          pairMonth: s.pairMonth,
          client1: c1 ? formatClientName(c1.lastName, c1.firstName) : s.clientId1,
          client2: c2 ? formatClientName(c2.lastName, c2.firstName) : "",
          client3: c3 ? formatClientName(c3.lastName, c3.firstName) : "",
          client1tg: c1?.telegram || "",
          client2tg: c2?.telegram || "",
          client3tg: c3?.telegram || "",
          lessonsTotal: s.lessonsTotal,
          lessonsLeft: s.lessonsLeft,
          freezeUsed: s.freezeUsed,
          activationDate: s.activationDate,
        };
      });
  }, [subscriptionsQuery.data, clientsQuery.data]);

  return {
    data,
    isLoading: subscriptionsQuery.isLoading || clientsQuery.isLoading,
    isError: subscriptionsQuery.isError || clientsQuery.isError,
    error: subscriptionsQuery.error ?? clientsQuery.error,
  };
}

export function useAddSubscription() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (sub: {
      type: string;
      clientId1: string;
      clientId2: string;
      clientId3?: string;
      clientId4?: string;
      lessonsTotal: number;
      activationDate: string;
      pairMonth: string;
      disciplineId: string;
      priceId?: string | null;
      category?: "group" | "private";
      billingModel?: BillingModel;
      scheduleGroupIds?: string[];
      capacityOverrideReason?: string | null;
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const billingModel = sub.billingModel ?? "lesson_count";
      const isMonthly = billingModel === "monthly_unlimited";
      const id = crypto.randomUUID();
      const subscriptionType = sub.type.trim();
      const pairMonth = normalizeSubscriptionPairMonth(subscriptionType, sub.pairMonth);
      const expiresAt = isMonthly ? computeMonthlyExpiresAt(sub.activationDate) : null;
      const isGroupSale = (sub.scheduleGroupIds?.length ?? 0) > 0 || sub.category === "group";

      if (isGroupSale && (sub.scheduleGroupIds?.length ?? 0) > 0) {
        const { data, error } = await supabase.rpc("create_group_subscription", {
          p_type: subscriptionType,
          p_client_id1: sub.clientId1,
          p_client_id2: sub.clientId2 || null,
          p_client_id3: sub.clientId3 || null,
          p_client_id4: sub.clientId4 || null,
          p_lessons_total: isMonthly ? 0 : sub.lessonsTotal,
          p_activation_date: sub.activationDate,
          p_pair_month: pairMonth,
          p_discipline_id: sub.disciplineId,
          p_price_id: sub.priceId ?? null,
          p_billing_model: billingModel,
          p_schedule_group_ids: sub.scheduleGroupIds,
          p_subscription_id: id,
          p_capacity_override_reason: sub.capacityOverrideReason ?? null,
          p_expires_at: expiresAt,
        });

        if (error) return { success: false as const, error: error.message };

        const result = data as {
          success?: boolean;
          error?: string;
          id?: string;
          class_id?: string;
          max_capacity?: number;
          occupied?: number;
          requested?: number;
        } | null;

        if (!result?.success) {
          if (result?.error === "group_capacity_exceeded") {
            return {
              success: false as const,
              error: "subscriptions.error.groupCapacityExceeded",
              capacityConflict: {
                classId: String(result.class_id ?? ""),
                maxCapacity: Number(result.max_capacity ?? 0),
                occupied: Number(result.occupied ?? 0),
                requested: Number(result.requested ?? 0),
              },
            };
          }
          return { success: false as const, error: result?.error ?? "subscriptions.error.sellFailed" };
        }

        return { success: true as const, id: result.id ?? id };
      }

      const { error } = await supabase.from("subscriptions").insert({
        id,
        organization_id: organizationId,
        type: subscriptionType,
        client_id1: sub.clientId1,
        client_id2: sub.clientId2 || null,
        client_id3: sub.clientId3 || null,
        client_id4: sub.clientId4 || null,
        lessons_total: isMonthly ? 0 : sub.lessonsTotal,
        lessons_left: isMonthly ? 0 : sub.lessonsTotal,
        freeze_used: 0,
        activation_date: sub.activationDate,
        status: "active",
        pair_month: pairMonth,
        discipline_id: sub.disciplineId,
        price_id: sub.priceId ?? null,
        category: sub.category ?? "group",
        billing_model: billingModel,
        expires_at: expiresAt,
      });

      if (error) return { success: false as const, error: error.message };

      if ((sub.scheduleGroupIds?.length ?? 0) > 0) {
        const groupRows = sub.scheduleGroupIds!.map((scheduleGroupId) => ({
          organization_id: organizationId,
          subscription_id: id,
          schedule_group_id: scheduleGroupId,
        }));

        const { error: groupsError } = await supabase.from("subscription_groups").insert(groupRows);
        if (groupsError) {
          await supabase.from("subscriptions").delete().eq("id", id);
          return { success: false as const, error: groupsError.message };
        }
      }

      return { success: true as const, id };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
        void queryClient.invalidateQueries({ queryKey: subscriptionGroupsQueryKey });
        void queryClient.invalidateQueries({ queryKey: groupCapacityQueryKey });
        void queryClient.invalidateQueries({ queryKey: groupWaitlistQueryKey });
        void queryClient.invalidateQueries({ queryKey: groupSpotNotificationsQueryKey });
      }
    },
  });
}

export function useFinishSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subId: string) => {
      const { data, error } = await supabase.rpc("finish_subscription", {
        p_sub_id: subId,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "subscriptions.error.finishFailed" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
        void queryClient.invalidateQueries({ queryKey: groupCapacityQueryKey });
        void queryClient.invalidateQueries({ queryKey: groupSpotNotificationsQueryKey });
      }
    },
  });
}
