import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type {
  AttendanceCorrectionRecord,
  CorrectionReportAttendanceRow,
  CorrectionReportPaymentRow,
  PaymentCorrectionReasonCode,
  PaymentWithCorrectionMeta,
} from "../lib/paymentCorrection";
import type { PaymentMethod } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { paymentsQueryKey } from "./usePayments";
import { personalLessonsQueryKey } from "./usePersonalLessons";
import { financialDebtorsQueryKey } from "./useFinancialDebtors";
import { attendanceQueryKey } from "./useAttendance";
import { subscriptionsQueryKey } from "./useSubscriptions";

export const correctionsQueryKey = ["corrections"] as const;

const PAYMENTS_CORRECTION_SELECT =
  "id, client_id, client_display, amount, method, method_comment, subscription_id, personal_lesson_id, single_visit_id, created_at, operation_kind, reverses_payment_id, replaces_payment_id, correction_reason_code, correction_comment, operation_number";

function mapPaymentRow(row: Record<string, unknown>): PaymentWithCorrectionMeta {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    clientDisplay: (row.client_display as string) || "",
    amount: Number(row.amount) || 0,
    method: (row.method as PaymentMethod) || "cash",
    methodComment: row.method_comment != null ? String(row.method_comment) : null,
    subscriptionId: row.subscription_id != null ? (row.subscription_id as string) : null,
    personalLessonId: row.personal_lesson_id != null ? (row.personal_lesson_id as string) : null,
    singleVisitId: row.single_visit_id != null ? (row.single_visit_id as string) : null,
    createdAt: String(row.created_at ?? ""),
    operationKind: (row.operation_kind as PaymentWithCorrectionMeta["operationKind"]) ?? "payment",
    reversesPaymentId: row.reverses_payment_id != null ? (row.reverses_payment_id as string) : null,
    replacesPaymentId: row.replaces_payment_id != null ? (row.replaces_payment_id as string) : null,
    correctionReasonCode: row.correction_reason_code != null ? String(row.correction_reason_code) : null,
    correctionComment: row.correction_comment != null ? String(row.correction_comment) : null,
    operationNumber: row.operation_number != null ? Number(row.operation_number) : null,
  };
}

export function usePaymentsWithCorrections(filter?: { dateFrom?: string; dateTo?: string }) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...paymentsQueryKey, "with-corrections", filter ?? {}]),
    enabled,
    queryFn: async () => {
      let query = supabase
        .from("payments")
        .select(PAYMENTS_CORRECTION_SELECT)
        .order("created_at", { ascending: false });

      if (filter?.dateFrom) query = query.gte("created_at", `${filter.dateFrom}T00:00:00`);
      if (filter?.dateTo) query = query.lte("created_at", `${filter.dateTo}T23:59:59`);

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data ?? []).map((row) => mapPaymentRow(row as Record<string, unknown>));
      const stornoByOriginal = new Map<string, number>();
      const hasReplacement = new Set<string>();

      for (const row of rows) {
        if (row.operationKind === "storno" && row.reversesPaymentId) {
          stornoByOriginal.set(
            row.reversesPaymentId,
            (stornoByOriginal.get(row.reversesPaymentId) ?? 0) + row.amount
          );
        }
        if (row.replacesPaymentId) {
          hasReplacement.add(row.replacesPaymentId);
        }
      }

      return rows.map((row) => {
        if (row.operationKind === "storno") {
          return { ...row, correctionStatus: "storno" as const };
        }
        const stornoTotal = stornoByOriginal.get(row.id) ?? 0;
        const remaining = Math.max(0, row.amount - stornoTotal);
        let correctionStatus: PaymentWithCorrectionMeta["correctionStatus"] = "active";
        if (hasReplacement.has(row.id)) correctionStatus = "replaced";
        else if (stornoTotal >= row.amount && stornoTotal > 0) correctionStatus = "voided";
        else if (stornoTotal > 0) correctionStatus = "partially_voided";
        return { ...row, stornoTotal, remainingAmount: remaining, correctionStatus };
      });
    },
    staleTime: 30 * 1000,
  });
}

export function useCorrectionsReport(dateFrom?: string, dateTo?: string) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...correctionsQueryKey, dateFrom ?? "", dateTo ?? ""]),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_corrections_report", {
        p_date_from: dateFrom ?? null,
        p_date_to: dateTo ?? null,
      });
      if (error) throw error;
      const result = data as {
        success?: boolean;
        error?: string;
        payments?: CorrectionReportPaymentRow[];
        attendance?: CorrectionReportAttendanceRow[];
      } | null;
      if (!result?.success) throw new Error(result?.error ?? "corrections.error.loadFailed");
      return {
        payments: result.payments ?? [],
        attendance: result.attendance ?? [],
      };
    },
    staleTime: 30 * 1000,
  });
}

function invalidatePaymentCaches(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
  void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
  void queryClient.invalidateQueries({ queryKey: financialDebtorsQueryKey });
  void queryClient.invalidateQueries({ queryKey: correctionsQueryKey });
}

export function useStornoPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      paymentId: string;
      reasonCode: PaymentCorrectionReasonCode;
      reasonComment?: string;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("storno_payment", {
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
      if (result.success) invalidatePaymentCaches(queryClient);
    },
  });
}

export function useCorrectPayment() {
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
      const { data, error } = await supabase.rpc("correct_payment", {
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
      if (result.success) invalidatePaymentCaches(queryClient);
    },
  });
}

export function useVoidPersonalLessonPaymentStorno() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      lessonId: string;
      reasonCode?: PaymentCorrectionReasonCode;
      reasonComment?: string;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("void_personal_lesson_payment", {
        p_lesson_id: input.lessonId,
        p_reason_code: input.reasonCode ?? "duplicate",
        p_reason_comment: input.reasonComment ?? null,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string; already_void?: boolean } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "corrections.error.stornoFailed" };
      }
      return { success: true as const, alreadyVoid: result.already_void ?? false };
    },
    onSuccess: (result) => {
      if (result.success) invalidatePaymentCaches(queryClient);
    },
  });
}

export function useCorrectAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      dateStr: string;
      subId: string;
      scheduleGroupId: string;
      newStatus: "present" | "absent" | "freeze" | "excused";
      reasonCode: string;
      reasonComment?: string;
      disciplineId?: string | null;
      expectedOldStatus?: string | null;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("correct_attendance", {
        p_date: input.dateStr,
        p_sub_id: input.subId,
        p_new_status: input.newStatus,
        p_schedule_group_id: input.scheduleGroupId,
        p_reason_code: input.reasonCode,
        p_reason_comment: input.reasonComment ?? null,
        p_discipline_id: input.disciplineId ?? null,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
        p_expected_old_status: input.expectedOldStatus ?? null,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        newLessonsLeft?: number;
        correction_id?: string;
        operation_number?: number;
        old_status?: string | null;
        already_applied?: boolean;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "corrections.error.attendanceFailed" };
      }
      return {
        success: true as const,
        newLessonsLeft: result.newLessonsLeft,
        correctionId: result.correction_id,
        operationNumber: result.operation_number,
        oldStatus: result.old_status,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
        void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
        void queryClient.invalidateQueries({ queryKey: correctionsQueryKey });
      }
    },
  });
}

export function useUndoAttendanceCorrection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { correctionId: string; idempotencyKey?: string }) => {
      const { data, error } = await supabase.rpc("undo_attendance_correction", {
        p_correction_id: input.correctionId,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        undo_id?: string;
        operation_number?: number;
        already_applied?: boolean;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "corrections.error.undoFailed" };
      }
      return {
        success: true as const,
        undoId: result.undo_id,
        operationNumber: result.operation_number,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
        void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
        void queryClient.invalidateQueries({ queryKey: correctionsQueryKey });
      }
    },
  });
}

export type { AttendanceCorrectionRecord };
