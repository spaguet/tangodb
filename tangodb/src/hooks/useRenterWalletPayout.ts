import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import { renterDetailQueryKey } from "./useRenterCrm";
import { rentersQueryKey } from "./useRenters";
import { useOrgQueryScope } from "./useOrgQueryScope";

export type RenterWalletPayoutMethod = "cash" | "card" | "transfer";

export interface RenterWalletPayoutQuote {
  walletBalance: number;
  spendable: number;
  reservedPrepay: number;
  debtToKeep: number;
  holdsFullCost: number;
  holdsCount: number;
  remaindersToKeep: number;
  liveBookingCount: number;
  obligated: number;
  refundable: number;
  currency: string;
}

export interface RenterWalletPayoutPreview {
  renterId: string;
  renterName: string;
  amount: number;
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

export function usePreviewRenterWalletPayout(
  input: { renterId: string; amount?: number | null } | null,
  enabled: boolean
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(["renterWalletPayout", "preview", input]),
    enabled: orgEnabled && enabled && !!input?.renterId,
    queryFn: async (): Promise<RenterWalletPayoutPreview> => {
      const payload: Record<string, unknown> = { renter_id: input!.renterId };
      if (input?.amount != null && Number.isFinite(input.amount)) {
        payload.amount = input.amount;
      }
      const { data, error } = await supabase.rpc("preview_renter_wallet_payout", {
        p_payload: asJson(payload),
      });
      if (error) throw error;
      const result = data as {
        success?: boolean;
        error?: string;
        renter_id?: string;
        renter_name?: string;
        amount?: number;
        amount_ok?: boolean;
        quote?: Record<string, unknown>;
      } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "renter.payout.previewFailed");
      }
      return {
        renterId: String(result.renter_id ?? input!.renterId),
        renterName: String(result.renter_name ?? ""),
        amount: Number(result.amount ?? 0),
        amountOk: result.amount_ok === true,
        quote: mapQuote(result.quote),
      };
    },
    staleTime: 5 * 1000,
  });
}

export function useStaffRenterWalletPayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      amount: number;
      method: RenterWalletPayoutMethod;
      reason: string;
      applicationAck: boolean;
      idempotencyKey: string;
      documentId?: string | null;
      externalReference?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("staff_renter_wallet_payout", {
        p_payload: asJson({
          renter_id: input.renterId,
          amount: input.amount,
          method: input.method,
          reason: input.reason.trim(),
          application_ack: input.applicationAck,
          idempotency_key: input.idempotencyKey,
          document_id: input.documentId ?? null,
          external_reference: input.externalReference?.trim() || null,
        }),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        already_applied?: boolean;
        amount?: number;
        spendable_after?: number;
      } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "renter.payout.failed",
        };
      }
      return {
        success: true as const,
        alreadyApplied: result.already_applied === true,
        amount: Number(result.amount ?? input.amount),
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
    },
  });
}
