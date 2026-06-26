import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { I18nKey } from "../lib/i18n/keys";
import { t } from "../lib/i18n";
import type { TranslateFn } from "../lib/utils";
import { supabase } from "../lib/supabase";
import { formatClientName } from "../lib/utils";
import type { Payment, PaymentMethod } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { personalLessonsQueryKey } from "./usePersonalLessons";

export const paymentsQueryKey = ["payments"] as const;

const PAYMENTS_SELECT =
  "id, client_id, client_display, amount, method, subscription_id, personal_lesson_id, created_at";

const mapPayment = (row: Record<string, unknown>): Payment => ({
  id: row.id as string,
  clientId: row.client_id as string,
  clientDisplay: (row.client_display as string) || "",
  amount: Number(row.amount) || 0,
  method: (row.method as PaymentMethod) || "cash",
  subscriptionId: row.subscription_id != null ? (row.subscription_id as string) : null,
  personalLessonId: row.personal_lesson_id != null ? (row.personal_lesson_id as string) : null,
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
  const recordPayment = useRecordPayment();

  return useMutation({
    mutationFn: async (input: {
      subscriptionId: string;
      clientId: string;
      clientFirstName: string;
      clientLastName: string;
      amount: number;
      method: PaymentMethod;
    }) => {
      return recordPayment.mutateAsync({
        clientId: input.clientId,
        clientDisplay: formatClientName(input.clientLastName, input.clientFirstName),
        amount: input.amount,
        method: input.method,
        subscriptionId: input.subscriptionId,
      });
    },
  });
}

export function useRecordPersonalLessonPayment() {
  const queryClient = useQueryClient();
  const { role } = useOrganization();
  const recordPayment = useRecordPayment();

  return useMutation({
    mutationFn: async (input: {
      lessonId: string;
      clientId: string;
      clientDisplay: string;
      amount: number;
      method: PaymentMethod;
      markPaid?: boolean;
    }) => {
      if (role === "teacher") {
        const { data, error } = await supabase.rpc("record_personal_lesson_payment", {
          p_lesson_id: input.lessonId,
          p_amount: input.amount,
          p_method: input.method,
        });

        if (error) return { success: false as const, error: error.message };
        const result = data as { success?: boolean; error?: string } | null;
        if (!result?.success) {
          return { success: false as const, error: result?.error ?? "subscriptions.error.paymentFailed" };
        }
        return { success: true as const };
      }

      const paymentResult = await recordPayment.mutateAsync({
        clientId: input.clientId,
        clientDisplay: input.clientDisplay,
        amount: input.amount,
        method: input.method,
        personalLessonId: input.lessonId,
      });

      if (!paymentResult.success) return paymentResult;

      if (input.markPaid !== false) {
        const { error } = await supabase
          .from("personal_lessons")
          .update({ paid: "yes" })
          .eq("id", input.lessonId);

        if (error) return { success: false as const, error: error.message };
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
        void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
      }
    },
  });
}

export function useVoidPersonalLessonPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (lessonId: string) => {
      const { error: deleteError } = await supabase
        .from("payments")
        .delete()
        .eq("personal_lesson_id", lessonId);

      if (deleteError) return { success: false as const, error: deleteError.message };

      const { error: updateError } = await supabase
        .from("personal_lessons")
        .update({ paid: "no" })
        .eq("id", lessonId);

      if (updateError) return { success: false as const, error: updateError.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
        void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
      }
    },
  });
}

const PAYMENT_METHOD_KEYS: Record<PaymentMethod, I18nKey> = {
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
  return "—";
}
