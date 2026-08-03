import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { PaymentMethod } from "../types";
import type { PaymentCorrectionReasonCode } from "../lib/paymentCorrection";
import { financialDebtorsQueryKey } from "./useFinancialDebtors";
import { correctionsQueryKey } from "./usePaymentCorrections";
import { rentalMoneyRegisterQueryKey } from "./useRentalMoneyRegister";
import { rentalsQueryKey } from "./useRentals";

function invalidateRentalCorrectionCaches(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: rentalMoneyRegisterQueryKey });
  void queryClient.invalidateQueries({ queryKey: rentalsQueryKey });
  void queryClient.invalidateQueries({ queryKey: financialDebtorsQueryKey });
  void queryClient.invalidateQueries({ queryKey: correctionsQueryKey });
}

export function useStornoRentalPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      paymentId: string;
      reasonCode: PaymentCorrectionReasonCode;
      reasonComment?: string;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("storno_rental_payment", {
        p_payment_id: input.paymentId,
        p_amount: null,
        p_reason_code: input.reasonCode,
        p_reason_comment: input.reasonComment ?? null,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        storno_id?: string;
        operation_number?: number;
        already_applied?: boolean;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "corrections.error.stornoFailed" };
      }
      return {
        success: true as const,
        stornoId: result.storno_id,
        operationNumber: result.operation_number,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) invalidateRentalCorrectionCaches(queryClient);
    },
  });
}

export function useCorrectRentalPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      paymentId: string;
      newAmount: number;
      newMethod: PaymentMethod;
      reasonCode: PaymentCorrectionReasonCode;
      reasonComment?: string;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("correct_rental_payment", {
        p_payment_id: input.paymentId,
        p_new_amount: input.newAmount,
        p_new_method: input.newMethod,
        p_reason_code: input.reasonCode,
        p_reason_comment: input.reasonComment ?? null,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        payment_id?: string;
        storno_id?: string;
        operation_number?: number;
        already_applied?: boolean;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "corrections.error.correctFailed" };
      }
      return {
        success: true as const,
        paymentId: result.payment_id,
        stornoId: result.storno_id,
        operationNumber: result.operation_number,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) invalidateRentalCorrectionCaches(queryClient);
    },
  });
}
