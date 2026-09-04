import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface StaffTopupPreviewEffect {
  walletBalanceBefore: number;
  walletBalanceAfter: number;
  spendableBefore: number;
  spendableAfter: number;
  miniappDebtBefore: number;
  miniappDebtAfter: number;
  reservedPrepayBefore: number;
  debtToSettle: number;
  holdsPrepayTotal: number;
  holdsToActivate: number;
}

export interface StaffTopupPreview {
  renterId: string;
  renterName: string;
  amount: number;
  method: RenterTopupMethod;
  externalReference: string | null;
  effect: StaffTopupPreviewEffect;
}
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
  correlationCode: string;
  qrAssetId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface RenterTopupInboxFilter {
  status?: RenterTopupInboxFilterStatus;
  search?: string;
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
    correlationCode: String(row.correlation_code ?? ""),
    qrAssetId: row.qr_asset_id != null ? String(row.qr_asset_id) : null,
    createdAt: String(row.created_at ?? ""),
    resolvedAt: row.resolved_at != null ? String(row.resolved_at) : null,
  };
}

export function useRenterTopupInbox(filter: RenterTopupInboxFilter = {}) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (filter.enabled ?? true);
  const pendingWatch = (filter.status ?? "pending") === "pending";

  return useQuery({
    queryKey: withOrgId([...renterTopupInboxQueryKey, filter]),
    enabled: queryEnabled,
    refetchInterval: pendingWatch ? 15_000 : false,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renter_topup_inbox", {
        p_status: filter.status ?? "pending",
        p_limit: filter.limit ?? 50,
        p_offset: filter.offset ?? 0,
        p_search: filter.search ?? null,
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
      const items = (payload.items ?? []).map((row) => mapItem(row));
      return {
        total: Number(payload.total ?? 0),
        limit: Number(payload.limit ?? 50),
        offset: Number(payload.offset ?? 0),
        items,
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

function mapStaffTopupPreview(data: Record<string, unknown>): StaffTopupPreview {
  const effect = (data.effect ?? {}) as Record<string, unknown>;
  return {
    renterId: String(data.renter_id ?? ""),
    renterName: String(data.renter_name ?? ""),
    amount: Number(data.amount) || 0,
    method: data.method === "qr" ? "qr" : "cash",
    externalReference: data.external_reference != null ? String(data.external_reference) : null,
    effect: {
      walletBalanceBefore: Number(effect.wallet_balance_before ?? 0),
      walletBalanceAfter: Number(effect.wallet_balance_after ?? 0),
      spendableBefore: Number(effect.spendable_before ?? 0),
      spendableAfter: Number(effect.spendable_after ?? 0),
      miniappDebtBefore: Number(effect.miniapp_debt_before ?? 0),
      miniappDebtAfter: Number(effect.miniapp_debt_after ?? 0),
      reservedPrepayBefore: Number(effect.reserved_prepay_before ?? 0),
      debtToSettle: Number(effect.debt_to_settle ?? 0),
      holdsPrepayTotal: Number(effect.holds_prepay_total ?? 0),
      holdsToActivate: Number(effect.holds_to_activate ?? 0),
    },
  };
}

export function useStaffTopupPreview(
  input: {
    renterId: string;
    amount: number;
    method: RenterTopupMethod;
    externalReference?: string;
  } | null,
  enabled: boolean
) {
  return useQuery({
    queryKey: ["staffTopupPreview", input],
    enabled: enabled && Boolean(input && input.amount > 0),
    queryFn: async () => {
      if (!input) throw new Error("renter.topup.amountInvalid");
      const { data, error } = await supabase.rpc("preview_staff_renter_wallet_topup", {
        p_payload: asJson({
          renter_id: input.renterId,
          amount: input.amount,
          method: input.method,
          external_reference: input.externalReference?.trim() || null,
        }),
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } & Record<string, unknown> | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "renter.topup.previewFailed");
      }
      return mapStaffTopupPreview(result);
    },
    staleTime: 0,
  });
}

export function useStaffRenterWalletTopup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      amount: number;
      method: RenterTopupMethod;
      idempotencyKey: string;
      externalReference?: string;
    }) => {
      const { data, error } = await supabase.rpc("staff_renter_wallet_topup", {
        p_payload: asJson({
          renter_id: input.renterId,
          amount: input.amount,
          method: input.method,
          idempotency_key: input.idempotencyKey,
          external_reference: input.externalReference?.trim() || null,
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

export function useReverseRenterWalletTopup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      ledgerEntryId: string;
      reason: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await supabase.rpc("reverse_renter_wallet_topup", {
        p_payload: asJson({
          ledger_entry_id: input.ledgerEntryId,
          reason: input.reason,
          idempotency_key: input.idempotencyKey,
        }),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renter.topup.reversalFailed" };
      }
      return { success: true as const };
    },
    onSuccess: (result, input) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: renterDetailQueryKey(input.renterId),
          refetchType: "active",
        });
      }
    },
  });
}
