import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { PaymentMethod, SingleVisit } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { paymentsQueryKey } from "./usePayments";
import { payrollQueryKey } from "./usePayroll";
import {
  checkVenueRuleBeforePayment,
  venueCostStatusQueryKey,
  venueRuleAckFailureFromRpc,
} from "./useVenueCosts";

export const singleVisitsQueryKey = ["single-visits"] as const;

const SINGLE_VISITS_SELECT =
  "id, visit_date, schedule_slot_id, schedule_group_id, client_id, client_display, price_id, amount, method, attendance_status, location_id, discipline_id, teacher_member_id, created_at";

const SINGLE_VISITS_SELECT_TEACHER =
  "id, visit_date, schedule_slot_id, schedule_group_id, client_id, client_display, attendance_status, location_id, discipline_id, teacher_member_id, created_at";

const mapSingleVisit = (row: Record<string, unknown>): SingleVisit => ({
  id: String(row.id),
  visitDate: String(row.visit_date ?? "").slice(0, 10),
  scheduleSlotId: String(row.schedule_slot_id),
  scheduleGroupId: String(row.schedule_group_id),
  clientId: String(row.client_id),
  clientDisplay: (row.client_display as string) || "",
  priceId: row.price_id != null ? String(row.price_id) : "",
  amount: Number(row.amount) || 0,
  method: (row.method as PaymentMethod) || "cash",
  attendanceStatus: "present",
  locationId: row.location_id != null ? String(row.location_id) : null,
  disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
  teacherMemberId: row.teacher_member_id != null ? String(row.teacher_member_id) : null,
  createdAt: String(row.created_at ?? ""),
});

export interface SingleVisitsFilter {
  dateFrom?: string;
  dateTo?: string;
  yearMonth?: string;
  enabled?: boolean;
}

function rangeFromFilter(filter?: SingleVisitsFilter): { dateFrom?: string; dateTo?: string } {
  if (filter?.yearMonth) {
    const [y, m] = filter.yearMonth.split("-").map(Number);
    if (y && m) {
      const mm = String(m).padStart(2, "0");
      const lastDay = new Date(y, m, 0).getDate();
      return {
        dateFrom: `${y}-${mm}-01`,
        dateTo: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
      };
    }
  }
  return { dateFrom: filter?.dateFrom, dateTo: filter?.dateTo };
}

export function useSingleVisits(filter?: SingleVisitsFilter) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role } = useOrganization();
  const maskFinancial = role === "teacher";
  const queryEnabled = orgEnabled && (filter?.enabled ?? true);
  const range = rangeFromFilter(filter);

  return useQuery({
    queryKey: withOrgId([...singleVisitsQueryKey, filter ?? {}, { maskFinancial }]),
    enabled: queryEnabled,
    queryFn: async () => {
      const applyRange = <T extends { gte: (col: string, val: string) => T; lte: (col: string, val: string) => T }>(
        query: T
      ) => {
        let scoped = query;
        if (range.dateFrom) scoped = scoped.gte("visit_date", range.dateFrom);
        if (range.dateTo) scoped = scoped.lte("visit_date", range.dateTo);
        return scoped;
      };

      if (maskFinancial) {
        let query = supabase
          .from("single_visits_teacher_v")
          .select(SINGLE_VISITS_SELECT_TEACHER)
          .order("visit_date", { ascending: false })
          .order("created_at", { ascending: false });
        query = applyRange(query);
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? []).map((row) => mapSingleVisit(row as unknown as Record<string, unknown>));
      }

      let query = supabase
        .from("single_visits")
        .select(SINGLE_VISITS_SELECT)
        .order("visit_date", { ascending: false })
        .order("created_at", { ascending: false });
      query = applyRange(query);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map((row) => mapSingleVisit(row as unknown as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useRecordSingleVisit() {
  const queryClient = useQueryClient();
  const { withOrgId } = useOrgQueryScope();
  const venueStatusQueryKey = withOrgId(venueCostStatusQueryKey);

  return useMutation({
    mutationFn: async (input: {
      visitDate: string;
      scheduleSlotId: string;
      clientId: string;
      priceId?: string | null;
      method: PaymentMethod;
      amount?: number;
      idempotencyKey?: string;
      venueRuleAcknowledged?: boolean;
    }) => {
      const venueGuard = await checkVenueRuleBeforePayment(input.venueRuleAcknowledged ?? false, {
        lessonDate: input.visitDate,
        cache: {
          queryClient,
          statusQueryKey: venueStatusQueryKey,
        },
      });
      if (venueGuard) return venueGuard;
      const { data, error } = await supabase.rpc("record_single_visit", {
        p_visit_date: input.visitDate,
        p_schedule_slot_id: input.scheduleSlotId,
        p_client_id: input.clientId,
        p_price_id: input.priceId || null,
        p_method: input.method,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
        p_amount: input.amount ?? null,
        p_venue_rule_acknowledged: input.venueRuleAcknowledged ?? false,
      });

      if (error) return { success: false as const, error: error.message };
      const result = data as {
        success?: boolean;
        error?: string;
        visitId?: string;
        payment_id?: string;
        operation_number?: number;
        already_applied?: boolean;
        error_code?: string;
        venue_rule_status?: Record<string, unknown>;
      } | null;
      if (!result?.success) {
        const ackFailure = venueRuleAckFailureFromRpc(result as Record<string, unknown> | null);
        if (ackFailure) return ackFailure;
        return { success: false as const, error: result?.error ?? "attendance.singleVisit.error.recordFailed" };
      }
      return {
        success: true as const,
        visitId: result.visitId,
        paymentId: result.payment_id,
        operationNumber: result.operation_number,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: singleVisitsQueryKey });
        void queryClient.invalidateQueries({ queryKey: paymentsQueryKey });
        void queryClient.invalidateQueries({ queryKey: payrollQueryKey });
      }
    },
  });
}
