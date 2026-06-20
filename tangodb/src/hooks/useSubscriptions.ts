import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { formatClientName, normalizeSubscriptionPairMonth } from "../lib/utils";
import type { ActiveSubscription, Subscription } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { useClientDirectory } from "./useClients";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const subscriptionsQueryKey = ["subscriptions"] as const;

const mapSubscription = (row: Record<string, unknown>, maskFinancial: boolean): Subscription => ({
  id: row.id as string,
  type: row.type as string,
  clientId1: row.client_id1 as string,
  clientId2: (row.client_id2 as string) || "",
  clientId3: (row.client_id3 as string) || "",
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
});

export function useSubscriptions(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role } = useOrganization();
  const maskFinancial = role === "teacher";
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
      lessonsTotal: number;
      activationDate: string;
      pairMonth: string;
      disciplineId: string;
      priceId?: string | null;
      category?: "group" | "private";
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "Организация не выбрана" };
      }

      const id = crypto.randomUUID();
      const subscriptionType = sub.type.trim();
      const pairMonth = normalizeSubscriptionPairMonth(subscriptionType, sub.pairMonth);

      const { error } = await supabase.from("subscriptions").insert({
        id,
        organization_id: organizationId,
        type: subscriptionType,
        client_id1: sub.clientId1,
        client_id2: sub.clientId2 || null,
        client_id3: sub.clientId3 || null,
        lessons_total: sub.lessonsTotal,
        lessons_left: sub.lessonsTotal,
        freeze_used: 0,
        activation_date: sub.activationDate,
        status: "active",
        pair_month: pairMonth,
        discipline_id: sub.disciplineId,
        price_id: sub.priceId ?? null,
        category: sub.category ?? "group",
      });

      if (error) return { success: false as const, error: error.message };
      return { success: true as const, id };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
    },
  });
}

export function useFinishSubscription() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subId: string) => {
      const { data, error } = await supabase
        .from("subscriptions")
        .update({ status: "finished" })
        .eq("id", subId)
        .select("id")
        .maybeSingle();

      if (error) return { success: false as const, error: error.message };
      if (!data) return { success: false as const, error: "Абонемент не найден" };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
    },
  });
}
