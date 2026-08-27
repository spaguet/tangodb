import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { monthDateRange } from "../lib/financeReports";
import { mapTeacherSettlementDetail } from "../lib/payrollSettlementDetail";
import { supabase } from "../lib/supabase";
import type {
  SettlementPaymentInput,
  TeacherPayRate,
  TeacherPayRateInput,
  TeacherSettlement,
  TeacherSettlementDetail,
  TeacherSettlementPayment,
} from "../types/payroll";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { orgScopedQueryFilter } from "../lib/orgQueryFilter";
import { paymentsQueryKey } from "./usePayments";

export const payrollQueryKey = ["payroll"] as const;
export const teacherPayRatesQueryKey = ["teacher-pay-rates"] as const;

const SETTLEMENTS_SELECT =
  "id, member_id, period_year, period_month, amount_accrued, amount_paid, computed_at";

const PAYMENTS_SELECT =
  "id, settlement_id, amount, paid_at, method, note, created_by, created_at";

const RATES_SELECT =
  "id, member_id, pay_mode, fixed_amount, rate_percent, group_rate_percent, personal_rate_percent, single_visit_rate_percent, effective_from, created_at";

function mapSettlement(row: Record<string, unknown>): TeacherSettlement {
  return {
    id: row.id as string,
    memberId: row.member_id as string,
    periodYear: Number(row.period_year),
    periodMonth: Number(row.period_month),
    amountAccrued: Number(row.amount_accrued) || 0,
    amountPaid: Number(row.amount_paid) || 0,
    computedAt: String(row.computed_at ?? ""),
  };
}

function mapSettlementPayment(row: Record<string, unknown>): TeacherSettlementPayment {
  return {
    id: row.id as string,
    settlementId: row.settlement_id as string,
    amount: Number(row.amount) || 0,
    paidAt: String(row.paid_at ?? ""),
    method: row.method as TeacherSettlementPayment["method"],
    note: (row.note as string) || "",
    createdBy: (row.created_by as string) || null,
    createdAt: String(row.created_at ?? ""),
  };
}

function mapPayRate(row: Record<string, unknown>): TeacherPayRate {
  const legacyRatePercent = Number(row.rate_percent) || 0;
  return {
    id: row.id as string,
    memberId: row.member_id as string,
    payMode: (row.pay_mode as TeacherPayRate["payMode"]) || "percent",
    fixedAmount: Number(row.fixed_amount) || 0,
    ratePercent: legacyRatePercent,
    groupRatePercent: Number(row.group_rate_percent) || legacyRatePercent,
    personalRatePercent: Number(row.personal_rate_percent) || legacyRatePercent,
    singleVisitRatePercent:
      Number(row.single_visit_rate_percent) || Number(row.group_rate_percent) || legacyRatePercent,
    effectiveFrom: String(row.effective_from ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

export function parseYearMonth(yearMonth: string): { year: number; month: number } {
  const [y, m] = yearMonth.split("-").map(Number);
  return { year: y, month: m };
}

export function useTeacherSettlements(yearMonth: string) {
  const { enabled, withOrgId } = useOrgQueryScope();
  const { year, month } = parseYearMonth(yearMonth);

  return useQuery({
    queryKey: withOrgId([...payrollQueryKey, "settlements", yearMonth]),
    enabled: enabled && !!year && !!month,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_settlements")
        .select(SETTLEMENTS_SELECT)
        .eq("period_year", year)
        .eq("period_month", month)
        .order("member_id");

      if (error) throw error;
      return (data ?? []).map((row) => mapSettlement(row as unknown as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

/** Last 12 months of settlements for the current teacher (RLS filters rows). */
export function useOwnTeacherSettlements(monthCount = 12) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...payrollQueryKey, "settlements-own", monthCount]),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_settlements")
        .select(SETTLEMENTS_SELECT)
        .order("period_year", { ascending: false })
        .order("period_month", { ascending: false })
        .limit(monthCount);

      if (error) throw error;
      return (data ?? []).map((row) => mapSettlement(row as unknown as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useSettlementPayments(settlementId: string | null) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...payrollQueryKey, "payments", settlementId]),
    enabled: enabled && !!settlementId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_settlement_payments")
        .select(PAYMENTS_SELECT)
        .eq("settlement_id", settlementId!)
        .order("paid_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => mapSettlementPayment(row as unknown as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useTeacherPayRates() {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(teacherPayRatesQueryKey),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teacher_pay_rates")
        .select(RATES_SELECT)
        .order("effective_from", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => mapPayRate(row as unknown as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
  });
}

/** Latest rate per teacher (by effective_from). */
export function activeRateByMember(rates: TeacherPayRate[]): Map<string, TeacherPayRate> {
  const map = new Map<string, TeacherPayRate>();
  for (const rate of rates) {
    if (!map.has(rate.memberId)) {
      map.set(rate.memberId, rate);
    }
  }
  return map;
}

export function useRecalculateTeacherSettlement() {
  const queryClient = useQueryClient();
  const { organizationId, withOrgId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (yearMonth: string) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }
      const { year, month } = parseYearMonth(yearMonth);
      const { error } = await supabase.rpc("recalculate_teacher_settlement", {
        p_org_id: organizationId,
        p_year: year,
        p_month: month,
      });
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries(orgScopedQueryFilter(payrollQueryKey, organizationId));
      }
    },
  });
}

export function useTeacherSettlementDetail(settlementId: string | null) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...payrollQueryKey, "settlement-detail", settlementId]),
    enabled: enabled && !!settlementId,
    queryFn: async (): Promise<TeacherSettlementDetail> => {
      const { data, error } = await supabase.rpc("get_teacher_settlement_detail", {
        p_settlement_id: settlementId!,
      });
      if (error) throw error;
      return mapTeacherSettlementDetail(data);
    },
    staleTime: 30 * 1000,
  });
}

export function useRecordSettlementPayment() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (input: SettlementPaymentInput) => {
      const { error } = await supabase.rpc("record_teacher_settlement_payment", {
        p_settlement_id: input.settlementId,
        p_amount: input.amount,
        p_paid_at: input.paidAt,
        p_method: input.method,
        p_note: input.note?.trim() || null,
      });
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries(orgScopedQueryFilter(payrollQueryKey, organizationId));
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
      }
    },
  });
}

export function useUpsertTeacherPayRate() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (input: TeacherPayRateInput) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const effectiveFrom = input.effectiveFrom ?? new Date().toISOString().slice(0, 10);

      const { data, error } = await supabase.rpc("save_teacher_pay_rate", {
        p_payload: {
          member_id: input.memberId,
          pay_mode: input.payMode,
          fixed_amount: input.fixedAmount,
          group_rate_percent: input.groupRatePercent,
          personal_rate_percent: input.personalRatePercent,
          single_visit_rate_percent: input.singleVisitRatePercent,
          effective_from: effectiveFrom,
        },
      });

      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error_code?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error_code ?? "teacher_pay_rate_save_failed" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries(orgScopedQueryFilter(teacherPayRatesQueryKey, organizationId));
        void queryClient.invalidateQueries(orgScopedQueryFilter(payrollQueryKey, organizationId));
      }
    },
  });
}

/** Payments in month — for client-side preview only. */
export function monthPaymentsFilter(yearMonth: string) {
  const range = monthDateRange(yearMonth);
  return { dateFrom: range.dateFrom, dateTo: range.dateTo };
}
