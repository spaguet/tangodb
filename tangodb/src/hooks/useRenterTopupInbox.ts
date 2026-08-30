import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import { renterDetailQueryKey } from "./useRenterCrm";
import { rentersQueryKey } from "./useRenters";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const renterTopupInboxQueryKey = ["renterTopupInbox"] as const;

export type RenterTopupStatus = "pending" | "confirmed" | "rejected";
export type RenterTopupMethod = "qr" | "cash";
export type RenterTopupInboxFilterStatus = RenterTopupStatus | "all";

export interface RenterTopupInboxItem {
  id: string;
  renterId: string;
  renterName: string;
  amount: number;
  method: RenterTopupMethod;
  status: RenterTopupStatus;
  amountFact: number | null;
  qrAssetId: string | null;
  qrSignedUrl: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface RenterTopupInboxFilter {
  status?: RenterTopupInboxFilterStatus;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

function mapItem(row: Record<string, unknown>): RenterTopupInboxItem {
  return {
    id: String(row.id),
    renterId: String(row.renter_id),
    renterName: String(row.renter_name ?? ""),
    amount: Number(row.amount) || 0,
    method: row.method === "qr" ? "qr" : "cash",
    status: (row.status as RenterTopupStatus) ?? "pending",
    amountFact: row.amount_fact != null ? Number(row.amount_fact) : null,
    qrAssetId: row.qr_asset_id != null ? String(row.qr_asset_id) : null,
    qrSignedUrl: row.qr_signed_url != null ? String(row.qr_signed_url) : null,
    createdAt: String(row.created_at ?? ""),
    resolvedAt: row.resolved_at != null ? String(row.resolved_at) : null,
  };
}

export function useRenterTopupInbox(filter: RenterTopupInboxFilter = {}) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (filter.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...renterTopupInboxQueryKey, filter]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renter_topup_inbox", {
        p_status: filter.status ?? "pending",
        p_limit: filter.limit ?? 50,
        p_offset: filter.offset ?? 0,
      });
      if (error) throw error;
      const payload = data as {
        success?: boolean;
        error?: string;
        items?: Record<string, unknown>[];
        total?: number;
        limit?: number;
        offset?: number;
      } | null;
      if (!payload?.success) {
        throw new Error(payload?.error ?? "renterTopup.error.loadFailed");
      }
      return {
        total: Number(payload.total ?? 0),
        limit: Number(payload.limit ?? 50),
        offset: Number(payload.offset ?? 0),
        items: (payload.items ?? []).map(mapItem),
      };
    },
    staleTime: 15 * 1000,
  });
}

export function useResolveRenterTopup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      id: string;
      action: "confirm" | "reject";
      amountFact?: number | null;
    }) => {
      const { data, error } = await supabase.rpc("resolve_renter_topup", {
        p_payload: asJson({
          id: input.id,
          action: input.action,
          amount_fact: input.amountFact ?? null,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        already_applied?: boolean;
        status?: string;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renterTopup.error.resolveFailed" };
      }
      return {
        success: true as const,
        alreadyApplied: Boolean(result.already_applied),
        status: result.status ?? null,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: renterTopupInboxQueryKey,
          refetchType: "active",
        });
        void queryClient.invalidateQueries({ queryKey: rentersQueryKey, refetchType: "active" });
      }
    },
  });
}

export function useStaffRenterWalletTopup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      amount: number;
      method: RenterTopupMethod;
    }) => {
      const { data, error } = await supabase.rpc("staff_renter_wallet_topup", {
        p_payload: asJson({
          renter_id: input.renterId,
          amount: input.amount,
          method: input.method,
          idempotency_key: crypto.randomUUID(),
        }),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renter.topup.amountInvalid" };
      }
      return { success: true as const };
    },
    onSuccess: (result, input) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: renterDetailQueryKey(input.renterId),
          refetchType: "active",
        });
        void queryClient.invalidateQueries({
          queryKey: renterTopupInboxQueryKey,
          refetchType: "active",
        });
      }
    },
  });
}
