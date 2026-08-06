import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";
import {
  mapRefundPreview,
  mapSubscriptionRefund,
  type RefundCalcMode,
  type SubscriptionRefundPreview,
  type SubscriptionRefundRecord,
} from "../lib/subscriptionRefund";
import { subscriptionsQueryKey } from "./useSubscriptions";
import { paymentsQueryKey } from "./usePayments";
import { payrollQueryKey } from "./usePayroll";
import type { PaymentMethod } from "../types";

export const subscriptionRefundsQueryKey = ["subscription-refunds"] as const;

export function useSubscriptionRefunds(options?: { subscriptionId?: string; enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...subscriptionRefundsQueryKey, options?.subscriptionId ?? "all"]),
    enabled: queryEnabled,
    queryFn: async () => {
      let query = supabase
        .from("subscription_refunds")
        .select("*")
        .order("created_at", { ascending: false });

      if (options?.subscriptionId) {
        query = query.eq("subscription_id", options.subscriptionId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) =>
        mapSubscriptionRefund(row as unknown as Record<string, unknown>)
      );
    },
    staleTime: 30 * 1000,
  });
}

export function usePreviewSubscriptionRefund(
  subscriptionId: string | null,
  calcOptions?: {
    calcMode?: RefundCalcMode;
    singleVisitRate?: number | null;
    singleVisitTariffId?: string | null;
  }
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const calcMode = calcOptions?.calcMode ?? "pro_rata";
  const singleVisitRate =
    calcMode === "single_visit_rate" && Number.isFinite(calcOptions?.singleVisitRate)
      ? calcOptions!.singleVisitRate!
      : null;

  return useQuery({
    queryKey: withOrgId([
      ...subscriptionRefundsQueryKey,
      "preview",
      subscriptionId,
      calcMode,
      singleVisitRate,
      calcOptions?.singleVisitTariffId ?? null,
    ]),
    enabled:
      orgEnabled &&
      !!subscriptionId &&
      (calcMode !== "single_visit_rate" || singleVisitRate != null),
    queryFn: async (): Promise<SubscriptionRefundPreview> => {
      const { data, error } = await supabase.rpc("preview_subscription_refund", {
        p_sub_id: subscriptionId!,
        p_calc_mode: calcMode,
        p_single_visit_rate: singleVisitRate,
        p_single_visit_tariff_id: calcOptions?.singleVisitTariffId ?? null,
      });
      if (error) throw error;

      const result = data as { success?: boolean; error?: string } & Record<string, unknown>;
      if (!result?.success) {
        throw new Error(result?.error ?? "subscriptions.refund.error.previewFailed");
      }

      return mapRefundPreview(result);
    },
    staleTime: 10 * 1000,
  });
}

export function useFinishSubscriptionWithRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      subscriptionId: string;
      recipientClientId: string;
      amount: number;
      method: PaymentMethod;
      reason: string;
      status?: "pending" | "completed";
      operationDate?: string;
      idempotencyKey?: string;
      calcMode?: RefundCalcMode;
      singleVisitRate?: number | null;
      singleVisitTariffId?: string | null;
      amountOverride?: boolean;
    }) => {
      const { data, error } = await supabase.rpc("finish_subscription_with_refund", {
        p_sub_id: input.subscriptionId,
        p_recipient_client_id: input.recipientClientId,
        p_amount: input.amount,
        p_method: input.method,
        p_reason: input.reason.trim(),
        p_status: input.status ?? "completed",
        p_operation_date: input.operationDate ?? null,
        p_idempotency_key: input.idempotencyKey ?? null,
        p_calc_mode: input.calcMode ?? "pro_rata",
        p_single_visit_rate:
          input.calcMode === "single_visit_rate" ? input.singleVisitRate ?? null : null,
        p_single_visit_tariff_id:
          input.calcMode === "single_visit_rate" ? input.singleVisitTariffId ?? null : null,
        p_amount_override: input.amountOverride ?? false,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        refundId?: string;
        amount?: number;
        status?: string;
        idempotentReplay?: boolean;
      } | null;

      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "subscriptions.refund.error.finishFailed",
        };
      }

      return {
        success: true as const,
        refundId: result.refundId,
        amount: Number(result.amount) || 0,
        status: result.status,
        idempotentReplay: result.idempotentReplay === true,
      };
    },
    onSuccess: invalidateRefundQueries(queryClient),
  });
}

export function useCreateSubscriptionRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      subscriptionId: string;
      recipientClientId: string;
      amount: number;
      method: PaymentMethod;
      reason: string;
      status?: "pending" | "completed";
      operationDate?: string;
      idempotencyKey?: string;
      lessonsToDeduct?: number | null;
    }) => {
      const { data, error } = await supabase.rpc("create_subscription_refund", {
        p_sub_id: input.subscriptionId,
        p_recipient_client_id: input.recipientClientId,
        p_amount: input.amount,
        p_method: input.method,
        p_reason: input.reason.trim(),
        p_status: input.status ?? "completed",
        p_operation_date: input.operationDate ?? null,
        p_idempotency_key: input.idempotencyKey ?? null,
        p_lessons_to_deduct: input.lessonsToDeduct ?? null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        refundId?: string;
        amount?: number;
        status?: string;
        lessonsDeducted?: number;
        idempotentReplay?: boolean;
      } | null;

      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "subscriptions.refund.error.partialFailed",
        };
      }

      return {
        success: true as const,
        refundId: result.refundId,
        amount: Number(result.amount) || 0,
        status: result.status,
        lessonsDeducted: Number(result.lessonsDeducted) || 0,
        idempotentReplay: result.idempotentReplay === true,
      };
    },
    onSuccess: invalidateRefundQueries(queryClient),
  });
}

export function useCompleteSubscriptionRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { refundId: string; operationDate?: string }) => {
      const { data, error } = await supabase.rpc("complete_subscription_refund", {
        p_refund_id: input.refundId,
        p_operation_date: input.operationDate ?? null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; refundId?: string; amount?: number } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "subscriptions.refund.error.completeFailed",
        };
      }

      return {
        success: true as const,
        refundId: result.refundId,
        amount: Number(result.amount) || 0,
      };
    },
    onSuccess: invalidateRefundQueries(queryClient),
  });
}

export function useCancelSubscriptionRefund() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { refundId: string; reason?: string }) => {
      const { data, error } = await supabase.rpc("cancel_subscription_refund", {
        p_refund_id: input.refundId,
        p_reason: input.reason?.trim() || null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; refundId?: string } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "subscriptions.refund.error.cancelFailed",
        };
      }

      return { success: true as const, refundId: result.refundId };
    },
    onSuccess: invalidateRefundQueries(queryClient),
  });
}

function invalidateRefundQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return () => {
    void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
    void queryClient.invalidateQueries({ queryKey: subscriptionRefundsQueryKey });
    void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
    void queryClient.invalidateQueries({ queryKey: payrollQueryKey });
  };
}

export type { SubscriptionRefundPreview, SubscriptionRefundRecord };
