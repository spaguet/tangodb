import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import { renterDetailQueryKey } from "./useRenterCrm";
import { rentersQueryKey } from "./useRenters";
import { useOrgQueryScope } from "./useOrgQueryScope";
import type { RenterWalletPayoutQuote } from "./useRenterWalletPayout";

export type RenterWalletAdjustDirection = "credit" | "debit" | "none";

export interface RenterWalletAdjustPreview {
  renterId: string;
  renterName: string;
  targetAmount: number;
  currentAmount: number;
  delta: number;
  direction: RenterWalletAdjustDirection;
  minAmount: number;
  maxAmount: number;
  amountOk: boolean;
  quote: RenterWalletPayoutQuote;
}

function mapQuote(row: Record<string, unknown> | null | undefined): RenterWalletPayoutQuote {
  return {
    walletBalance: Number(row?.wallet_balance ?? 0),
    spendable: Number(row?.spendable ?? 0),
    reservedPrepay: Number(row?.reserved_prepay ?? 0),
    debtToKeep: Number(row?.debt_to_keep ?? 0),
    holdsFullCost: Number(row?.holds_full_cost ?? 0),
    holdsCount: Number(row?.holds_count ?? 0),
    remaindersToKeep: Number(row?.remainders_to_keep ?? 0),
    liveBookingCount: Number(row?.live_booking_count ?? 0),
    obligated: Number(row?.obligated ?? 0),
    refundable: Number(row?.refundable ?? 0),
    currency: String(row?.currency ?? ""),
  };
}

function mapDirection(value: unknown): RenterWalletAdjustDirection {
  if (value === "credit" || value === "debit") return value;
  return "none";
}

export function usePreviewRenterWalletAdjust(
  input: { renterId: string; targetAmount?: number | null } | null,
  enabled: boolean
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(["renterWalletAdjust", "preview", input]),
    enabled: orgEnabled && enabled && !!input?.renterId,
    queryFn: async (): Promise<RenterWalletAdjustPreview> => {
      const payload: Record<string, unknown> = { renter_id: input!.renterId };
      if (input?.targetAmount != null && Number.isFinite(input.targetAmount)) {
        payload.target_amount = input.targetAmount;
      }
      const { data, error } = await supabase.rpc("preview_staff_renter_wallet_adjust", {
        p_payload: asJson(payload),
      });
      if (error) throw error;
      const result = data as {
        success?: boolean;
        error?: string;
        renter_id?: string;
        renter_name?: string;
        target_amount?: number;
        current_amount?: number;
        delta?: number;
        direction?: string;
        min_amount?: number;
        max_amount?: number;
        amount_ok?: boolean;
        quote?: Record<string, unknown>;
      } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "renter.walletAdjust.previewFailed");
      }
      return {
        renterId: String(result.renter_id ?? input!.renterId),
        renterName: String(result.renter_name ?? ""),
        targetAmount: Number(result.target_amount ?? 0),
        currentAmount: Number(result.current_amount ?? 0),
        delta: Number(result.delta ?? 0),
        direction: mapDirection(result.direction),
        minAmount: Number(result.min_amount ?? 0),
        maxAmount: Number(result.max_amount ?? 0),
        amountOk: result.amount_ok === true,
        quote: mapQuote(result.quote),
      };
    },
    staleTime: 5 * 1000,
  });
}

export function useStaffRenterWalletAdjust() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      targetAmount: number;
      reason: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await supabase.rpc("staff_renter_wallet_adjust", {
        p_payload: asJson({
          renter_id: input.renterId,
          target_amount: input.targetAmount,
          reason: input.reason.trim(),
          idempotency_key: input.idempotencyKey,
        }),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        already_applied?: boolean;
        wallet_balance_after?: number;
        spendable_after?: number;
      } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "renter.walletAdjust.failed",
        };
      }
      return {
        success: true as const,
        alreadyApplied: result.already_applied === true,
        walletBalanceAfter: Number(result.wallet_balance_after ?? 0),
        spendableAfter: Number(result.spendable_after ?? 0),
      };
    },
    onSuccess: (result, input) => {
      if (!result.success) return;
      void queryClient.invalidateQueries({
        queryKey: renterDetailQueryKey(input.renterId),
        refetchType: "active",
      });
      void queryClient.invalidateQueries({ queryKey: rentersQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({
        queryKey: ["rentalMoneyRegister"],
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["renterWalletAdjust"],
        refetchType: "active",
      });
      void queryClient.invalidateQueries({
        queryKey: ["renterWalletPayout"],
        refetchType: "active",
      });
    },
  });
}
