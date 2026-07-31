import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { I18nKey } from "../lib/i18n/keys";
import { t } from "../lib/i18n";
import type { TranslateFn } from "../lib/utils";
import { FINANCIAL_TREND_MONTH_COUNT, monthTrendRange } from "../lib/financeReports";
import { supabase } from "../lib/supabase";
import { formatClientName } from "../lib/utils";
import type { Payment, PaymentMethod } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { personalLessonsQueryKey } from "./usePersonalLessons";
import { financialDebtorsQueryKey } from "./useFinancialDebtors";

export const paymentsQueryKey = ["payments"] as const;

const PAYMENTS_SELECT =
  "id, client_id, client_display, amount, method, method_comment, subscription_id, personal_lesson_id, single_visit_id, created_by, created_at";

const mapPayment = (row: Record<string, unknown>): Payment => ({
  id: row.id as string,
  clientId: row.client_id as string,
  clientDisplay: (row.client_display as string) || "",
  amount: Number(row.amount) || 0,
  method: (row.method as PaymentMethod) || "cash",
  methodComment: row.method_comment != null ? String(row.method_comment) : null,
  subscriptionId: row.subscription_id != null ? (row.subscription_id as string) : null,
  personalLessonId: row.personal_lesson_id != null ? (row.personal_lesson_id as string) : null,
  singleVisitId: row.single_visit_id != null ? (row.single_visit_id as string) : null,
  createdBy: row.created_by != null ? (row.created_by as string) : null,
  createdAt: String(row.created_at ?? ""),
});

export interface PaymentsFilter {
  dateFrom?: string;
  dateTo?: string;
  todayOnly?: boolean;
  enabled?: boolean;
}

function buildPaymentsQuery(filter?: PaymentsFilter) {
  let query = supabase.from("payments").select(PAYMENTS_SELECT).order("created_at", { ascending: false });

  if (filter?.todayOnly) {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    query = query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  } else {
    if (filter?.dateFrom) query = query.gte("created_at", `${filter.dateFrom}T00:00:00`);
    if (filter?.dateTo) query = query.lte("created_at", `${filter.dateTo}T23:59:59`);
  }

  return query;
}

export function usePayments(filter?: PaymentsFilter) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (filter?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...paymentsQueryKey, filter ?? {}]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await buildPaymentsQuery(filter);
      if (error) throw error;
      return (data ?? []).map((row) => mapPayment(row as unknown as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

/** Single query for owner KPI trend (6 months ending at `endMonth`, client-side aggregation). */
export function usePaymentsTrend(endMonth: string, monthCount = FINANCIAL_TREND_MONTH_COUNT) {
  const range = monthTrendRange(endMonth, monthCount);
  return usePayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });
}

export function useRecordPayment() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  const { memberId } = useOrganization();

  return useMutation({
    mutationFn: async (input: {
      clientId: string;
      clientDisplay: string;
      amount: number;
      method: PaymentMethod;
      subscriptionId?: string;
      personalLessonId?: string;
      singleVisitId?: string;
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const { error } = await supabase.from("payments").insert({
        organization_id: organizationId,
        client_id: input.clientId,
        client_display: input.clientDisplay,
        amount: input.amount,
        method: input.method,
        subscription_id: input.subscriptionId ?? null,
        personal_lesson_id: input.personalLessonId ?? null,
        single_visit_id: input.singleVisitId ?? null,
        created_by: memberId ?? null,
      });

      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
      }
    },
  });
}

export function useRecordSubscriptionPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      subscriptionId: string;
      clientId: string;
      clientFirstName: string;
      clientLastName: string;
      amount: number;
      method: PaymentMethod;
      methodComment?: string;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_subscription_payment", {
        p_subscription_id: input.subscriptionId,
        p_amount: input.amount,
        p_method: input.method,
        p_method_comment: input.methodComment ?? null,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });

      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        payment_id?: string;
        operation_number?: number;
        already_applied?: boolean;
      } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "subscriptions.error.paymentFailed",
        };
      }
      return {
        success: true as const,
        paymentId: result.payment_id,
        operationNumber: result.operation_number,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
      }
    },
  });
}

export function useRecordPersonalLessonPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      lessonId: string;
      clientId: string;
      clientDisplay: string;
      amount: number;
      method: PaymentMethod;
      markPaid?: boolean;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_personal_lesson_payment", {
        p_lesson_id: input.lessonId,
        p_amount: input.amount,
        p_method: input.method,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });

      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        payment_id?: string;
        operation_number?: number;
        already_applied?: boolean;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "subscriptions.error.paymentFailed" };
      }
      return {
        success: true as const,
        paymentId: result.payment_id,
        operationNumber: result.operation_number,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
        void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
        void queryClient.invalidateQueries({ queryKey: financialDebtorsQueryKey });
      }
    },
  });
}

export function useVoidPersonalLessonPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: string | { lessonId: string; reasonCode?: string; idempotencyKey?: string }) => {
      const lessonId = typeof input === "string" ? input : input.lessonId;
      const { data, error } = await supabase.rpc("void_personal_lesson_payment", {
        p_lesson_id: lessonId,
        p_reason_code: typeof input === "string" ? "duplicate" : input.reasonCode ?? "duplicate",
        p_reason_comment: null,
        p_idempotency_key:
          typeof input === "string" ? crypto.randomUUID() : input.idempotencyKey ?? crypto.randomUUID(),
      });

      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string; already_void?: boolean } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "corrections.error.stornoFailed" };
      }
      return { success: true as const, alreadyVoid: result.already_void ?? false };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
        void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
        void queryClient.invalidateQueries({ queryKey: financialDebtorsQueryKey });
      }
    },
  });
}

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card", "other"];

export const PAYMENT_METHOD_KEYS: Record<PaymentMethod, I18nKey> = {
  cash: "common.payment.cash",
  transfer: "common.payment.transfer",
  card: "common.payment.card",
  other: "common.payment.other",
};

/** @deprecated Use getPaymentMethodLabel(method, translate, locale) */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: t("ru-RU", "common.payment.cash"),
  transfer: t("ru-RU", "common.payment.transfer"),
  card: t("ru-RU", "common.payment.card"),
  other: t("ru-RU", "common.payment.other"),
};

export function getPaymentMethodLabel(
  method: PaymentMethod,
  translate?: TranslateFn,
  locale?: string | null
): string {
  const key = PAYMENT_METHOD_KEYS[method];
  return translate ? translate(key) : t(locale, key);
}

export function paymentSourceLabel(
  payment: Payment,
  translate?: TranslateFn,
  locale?: string | null
): string {
  if (payment.subscriptionId) {
    return translate
      ? translate("common.payment.source.subscription")
      : t(locale, "common.payment.source.subscription");
  }
  if (payment.personalLessonId) {
    return translate
      ? translate("common.payment.source.personalLesson")
      : t(locale, "common.payment.source.personalLesson");
  }
  if (payment.singleVisitId) {
    return translate
      ? translate("common.payment.source.singleVisit")
      : t(locale, "common.payment.source.singleVisit");
  }
  return "—";
}
