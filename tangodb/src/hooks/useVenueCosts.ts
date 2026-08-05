import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  venueCostDraftToPayload,
  type VenueCostAttendanceTier,
  type VenueCostGroupRule,
  type VenueCostMode,
  type VenueCostPersonalRule,
  type VenueCostRuleDraft,
  type VenueCostRuleStatusCode,
  type VenueCostRules,
} from "../lib/venueCostRules";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const venueCostStatusQueryKey = ["venue-costs", "status"] as const;
export const venueCostVersionsQueryKey = ["venue-costs", "versions"] as const;

export interface VenueCostRuleStatus {
  status: VenueCostRuleStatusCode;
  acknowledgementRequired: boolean;
  currentRuleId: string | null;
  currentMode: VenueCostMode | null;
  latestRuleId: string | null;
  latestMode: VenueCostMode | null;
  latestValidTo: string | null;
  pendingUnpricedCount: number;
  asOf: string;
}

export interface VenueCostRuleVersion {
  id: string;
  versionNumber: number;
  status: "draft" | "accepted";
  mode: VenueCostMode;
  validFrom: string;
  validTo: string | null;
  rules: VenueCostRules;
  createdAt: string;
  updatedAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
}

type RpcObject = Record<string, unknown>;

const nullableString = (value: unknown): string | null =>
  value == null || value === "" ? null : String(value);

export function mapVenueCostStatus(row: RpcObject): VenueCostRuleStatus {
  return {
    status: String(row.status ?? "not_configured") as VenueCostRuleStatusCode,
    acknowledgementRequired: row.acknowledgement_required === true,
    currentRuleId: nullableString(row.current_rule_id),
    currentMode: nullableString(row.current_mode) as VenueCostMode | null,
    latestRuleId: nullableString(row.latest_rule_id),
    latestMode: nullableString(row.latest_mode) as VenueCostMode | null,
    latestValidTo: nullableString(row.latest_valid_to)?.slice(0, 10) ?? null,
    pendingUnpricedCount: Number(row.pending_unpriced_count) || 0,
    asOf: String(row.as_of ?? ""),
  };
}

const mapGroupRule = (row: RpcObject): VenueCostGroupRule => ({
  teacherMemberId: nullableString(row.teacher_member_id),
  disciplineId: nullableString(row.discipline_id),
  locationId: nullableString(row.location_id),
  attendanceTiers: Array.isArray(row.attendance_tiers)
    ? row.attendance_tiers.map((tier) => {
        const item = tier as RpcObject;
        return {
          minAttendees: Number(item.min_attendees) || 0,
          maxAttendees: item.max_attendees == null ? null : Number(item.max_attendees),
          amount: Number(item.amount) || 0,
        } satisfies VenueCostAttendanceTier;
      })
    : [],
});

const mapPersonalRule = (row: RpcObject): VenueCostPersonalRule => ({
  teacherMemberId: nullableString(row.teacher_member_id),
  disciplineId: nullableString(row.discipline_id),
  locationId: nullableString(row.location_id),
  amount: Number(row.amount) || 0,
});

function mapRules(mode: VenueCostMode, value: unknown): VenueCostRules {
  const rules = (value && typeof value === "object" ? value : {}) as RpcObject;
  if (mode === "per_lesson") {
    return {
      currency: String(rules.currency ?? "RUB"),
      group: Array.isArray(rules.group) ? rules.group.map((row) => mapGroupRule(row as RpcObject)) : [],
      personal: Array.isArray(rules.personal)
        ? rules.personal.map((row) => mapPersonalRule(row as RpcObject))
        : [],
    };
  }
  if (mode === "fixed_period") {
    const locations = Array.isArray(rules.locations)
      ? rules.locations.map((row) => {
          const item = row as RpcObject;
          return {
            locationId: String(item.location_id ?? ""),
            amount: Number(item.amount) || 0,
          };
        })
      : undefined;
    return {
      currency: String(rules.currency ?? "RUB"),
      period: String(rules.period ?? "month") as "week" | "month" | "custom",
      amount: Number(rules.amount) || 0,
      ...(locations?.length ? { locations } : {}),
    };
  }
  return {};
}

export function mapVenueCostVersion(row: RpcObject): VenueCostRuleVersion {
  const mode = String(row.mode) as VenueCostMode;
  return {
    id: String(row.id),
    versionNumber: Number(row.version_number) || 0,
    status: String(row.status) as "draft" | "accepted",
    mode,
    validFrom: String(row.valid_from ?? "").slice(0, 10),
    validTo: nullableString(row.valid_to)?.slice(0, 10) ?? null,
    rules: mapRules(mode, row.rules),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    acceptedAt: nullableString(row.accepted_at),
    acceptedBy: nullableString(row.accepted_by),
  };
}

export async function fetchVenueCostRuleStatus(): Promise<VenueCostRuleStatus> {
  const { data, error } = await supabase.rpc("get_venue_cost_rule_status", { p_at: null });
  if (error) throw error;
  const result = data as RpcObject | null;
  if (!result?.success) throw new Error(String(result?.error_code ?? "venue_cost_status_failed"));
  return mapVenueCostStatus(result);
}

export interface VenueRuleAckRequiredFailure {
  success: false;
  error: "venue_rule_ack_required";
  errorCode: "venue_rule_ack_required";
  venueRuleStatus: VenueCostRuleStatus;
}

export async function checkVenueRuleBeforePayment(
  acknowledged: boolean,
  cache?: { queryClient: QueryClient; statusQueryKey: readonly unknown[] }
): Promise<VenueRuleAckRequiredFailure | null> {
  if (acknowledged) return null;
  const status = cache
    ? await cache.queryClient.fetchQuery({
        queryKey: cache.statusQueryKey,
        queryFn: fetchVenueCostRuleStatus,
        staleTime: 30_000,
      })
    : await fetchVenueCostRuleStatus();
  return status.acknowledgementRequired
    ? { success: false, error: "venue_rule_ack_required", errorCode: "venue_rule_ack_required", venueRuleStatus: status }
    : null;
}

export function venueRuleAckFailureFromRpc(result: RpcObject | null): VenueRuleAckRequiredFailure | null {
  if (result?.error_code !== "venue_rule_ack_required") return null;
  return {
    success: false,
    error: "venue_rule_ack_required",
    errorCode: "venue_rule_ack_required",
    venueRuleStatus: mapVenueCostStatus((result.venue_rule_status ?? {}) as RpcObject),
  };
}

export function useVenueCostRuleStatus() {
  const { enabled, withOrgId } = useOrgQueryScope();
  return useQuery({
    queryKey: withOrgId(venueCostStatusQueryKey),
    enabled,
    queryFn: fetchVenueCostRuleStatus,
    staleTime: 30_000,
  });
}

export function useVenueCostRuleVersions() {
  const { enabled, withOrgId } = useOrgQueryScope();
  return useQuery({
    queryKey: withOrgId(venueCostVersionsQueryKey),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_venue_cost_rule_versions");
      if (error) throw error;
      const result = data as RpcObject | null;
      if (!result?.success) throw new Error(String(result?.error_code ?? "venue_cost_versions_failed"));
      return (Array.isArray(result.versions) ? result.versions : []).map((row) =>
        mapVenueCostVersion(row as RpcObject)
      );
    },
    staleTime: 30_000,
  });
}

function useInvalidateVenueCosts() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["venue-costs"] });
    void queryClient.invalidateQueries({ queryKey: ["finance-costs"] });
    void queryClient.invalidateQueries({ queryKey: lessonClosuresQueryKey });
  };
}

export const lessonClosuresQueryKey = ["venue-costs", "closures"] as const;

export interface LessonOccurrenceClosure {
  id: string;
  occurrenceKind: "group" | "personal";
  occurrenceDate: string;
  scheduleSlotId: string | null;
  personalLessonId: string | null;
  sourcePersonalLessonId: string | null;
  confirmedAttendeeCount: number | null;
  status: "closed" | "reopened";
  pricingStatus: string;
  closedAt: string;
}

function mapLessonClosure(row: RpcObject): LessonOccurrenceClosure {
  return {
    id: String(row.id),
    occurrenceKind: String(row.occurrence_kind) as "group" | "personal",
    occurrenceDate: String(row.occurrence_date ?? "").slice(0, 10),
    scheduleSlotId: nullableString(row.schedule_slot_id),
    personalLessonId: nullableString(row.personal_lesson_id),
    sourcePersonalLessonId: nullableString(row.source_personal_lesson_id),
    confirmedAttendeeCount:
      row.confirmed_attendee_count == null ? null : Number(row.confirmed_attendee_count),
    status: String(row.status) as "closed" | "reopened",
    pricingStatus: String(row.pricing_status ?? ""),
    closedAt: String(row.closed_at ?? ""),
  };
}

const CLOSURE_SELECT =
  "id, occurrence_kind, occurrence_date, schedule_slot_id, personal_lesson_id, source_personal_lesson_id, confirmed_attendee_count, status, pricing_status, closed_at";

export function useActiveGroupLessonClosure(
  scheduleSlotId: string | null | undefined,
  occurrenceDate: string | null | undefined
) {
  const { enabled, withOrgId } = useOrgQueryScope();
  return useQuery({
    queryKey: withOrgId([...lessonClosuresQueryKey, "group", scheduleSlotId ?? "", occurrenceDate ?? ""]),
    enabled: enabled && Boolean(scheduleSlotId && occurrenceDate),
    queryFn: async (): Promise<LessonOccurrenceClosure | null> => {
      const { data, error } = await supabase
        .from("lesson_occurrence_closures")
        .select(CLOSURE_SELECT)
        .eq("occurrence_kind", "group")
        .eq("schedule_slot_id", scheduleSlotId!)
        .eq("occurrence_date", occurrenceDate!)
        .eq("status", "closed")
        .maybeSingle();
      if (error) throw error;
      return data ? mapLessonClosure(data as RpcObject) : null;
    },
    staleTime: 15_000,
  });
}

export function useActivePersonalLessonClosure(
  personalLessonId: string | null | undefined,
  queryEnabled = true
) {
  const { enabled, withOrgId } = useOrgQueryScope();
  return useQuery({
    queryKey: withOrgId([...lessonClosuresQueryKey, "personal", personalLessonId ?? ""]),
    enabled: enabled && queryEnabled && Boolean(personalLessonId),
    queryFn: async (): Promise<LessonOccurrenceClosure | null> => {
      const { data, error } = await supabase
        .from("lesson_occurrence_closures")
        .select(CLOSURE_SELECT)
        .eq("occurrence_kind", "personal")
        .eq("source_personal_lesson_id", personalLessonId!)
        .eq("status", "closed")
        .maybeSingle();
      if (error) throw error;
      return data ? mapLessonClosure(data as RpcObject) : null;
    },
    staleTime: 15_000,
  });
}

/** Batch-fetch closed personal closures for a list of lesson IDs (avoids N+1 in tables). */
export function useClosedPersonalLessonClosures(personalLessonIds: string[], queryEnabled = true) {
  const { enabled, withOrgId } = useOrgQueryScope();
  const sortedIds = useMemo(
    () => [...new Set(personalLessonIds.filter(Boolean))].sort(),
    [personalLessonIds]
  );
  return useQuery({
    queryKey: withOrgId([...lessonClosuresQueryKey, "personal-batch", sortedIds.join(",")]),
    enabled: enabled && queryEnabled && sortedIds.length > 0,
    queryFn: async (): Promise<Map<string, LessonOccurrenceClosure>> => {
      const { data, error } = await supabase
        .from("lesson_occurrence_closures")
        .select(CLOSURE_SELECT)
        .eq("occurrence_kind", "personal")
        .eq("status", "closed")
        .in("source_personal_lesson_id", sortedIds);
      if (error) throw error;
      const map = new Map<string, LessonOccurrenceClosure>();
      for (const row of data ?? []) {
        const closure = mapLessonClosure(row as RpcObject);
        if (closure.sourcePersonalLessonId) {
          map.set(closure.sourcePersonalLessonId, closure);
        }
      }
      return map;
    },
    staleTime: 15_000,
  });
}

export function useSaveVenueCostRuleDraft() {
  const invalidate = useInvalidateVenueCosts();
  return useMutation({
    mutationFn: async (input: { draft: VenueCostRuleDraft; idempotencyKey: string }) => {
      const { data, error } = await supabase.rpc("save_venue_cost_rule_draft", {
        p_payload: venueCostDraftToPayload(input.draft),
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as RpcObject | null;
      if (!result?.success) {
        return { success: false as const, error: String(result?.error_code ?? "venue_cost_save_failed") };
      }
      return { success: true as const, ruleVersionId: String(result.rule_version_id) };
    },
    onSuccess: (result) => {
      if (result.success) invalidate();
    },
  });
}

export function useEndVenueCostRuleEarly() {
  const invalidate = useInvalidateVenueCosts();
  return useMutation({
    mutationFn: async (input: { ruleVersionId: string; endDate?: string; idempotencyKey?: string }) => {
      const { data, error } = await supabase.rpc("end_venue_cost_rule_early", {
        p_rule_version_id: input.ruleVersionId,
        p_end_date: input.endDate ?? new Date().toISOString().slice(0, 10),
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as RpcObject | null;
      if (!result?.success) {
        return { success: false as const, error: String(result?.error_code ?? "venue_cost_end_early_failed") };
      }
      return {
        success: true as const,
        ruleVersionId: String(result.rule_version_id ?? input.ruleVersionId),
        validTo: nullableString(result.valid_to)?.slice(0, 10) ?? null,
        alreadyApplied: result.already_applied === true,
      };
    },
    onSuccess: (result) => {
      if (result.success) invalidate();
    },
  });
}

export function useAcceptVenueCostRuleVersion() {
  const invalidate = useInvalidateVenueCosts();
  return useMutation({
    mutationFn: async (input: { ruleVersionId: string; idempotencyKey: string }) => {
      const { data, error } = await supabase.rpc("accept_venue_cost_rule_version", {
        p_rule_version_id: input.ruleVersionId,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as RpcObject | null;
      if (!result?.success) {
        return { success: false as const, error: String(result?.error_code ?? "venue_cost_accept_failed") };
      }
      return { success: true as const, alreadyApplied: result.already_applied === true };
    },
    onSuccess: (result) => {
      if (result.success) invalidate();
    },
  });
}

export interface VenueCostGapPreview {
  asOf: string;
  expiredRuleId: string;
  expiredRuleValidTo: string | null;
  suggestedGapFrom: string;
  suggestedGapTo: string | null;
  nextRuleValidFrom: string | null;
  draftVersionId: string | null;
  closedPendingUnpricedInGap: number;
  closedPricedInGap: number;
  pendingUnpricedTotal: number;
  pastWillNotRecalculate: boolean;
}

export function mapVenueCostGapPreview(row: RpcObject): VenueCostGapPreview {
  return {
    asOf: String(row.as_of ?? "").slice(0, 10),
    expiredRuleId: String(row.expired_rule_id ?? ""),
    expiredRuleValidTo: nullableString(row.expired_rule_valid_to)?.slice(0, 10) ?? null,
    suggestedGapFrom: String(row.suggested_gap_from ?? "").slice(0, 10),
    suggestedGapTo: nullableString(row.suggested_gap_to)?.slice(0, 10) ?? null,
    nextRuleValidFrom: nullableString(row.next_rule_valid_from)?.slice(0, 10) ?? null,
    draftVersionId: nullableString(row.draft_version_id),
    closedPendingUnpricedInGap: Number(row.closed_pending_unpriced_in_gap) || 0,
    closedPricedInGap: Number(row.closed_priced_in_gap) || 0,
    pendingUnpricedTotal: Number(row.pending_unpriced_total) || 0,
    pastWillNotRecalculate: row.past_will_not_recalculate === true,
  };
}

export function useVenueCostGapPreview(enabled: boolean) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  return useQuery({
    queryKey: withOrgId([...venueCostStatusQueryKey, "gap-preview"]),
    enabled: orgEnabled && enabled,
    queryFn: async (): Promise<VenueCostGapPreview> => {
      const { data, error } = await supabase.rpc("preview_venue_cost_gap_impact", { p_as_of: null });
      if (error) throw error;
      const result = data as RpcObject | null;
      if (!result?.success) throw new Error(String(result?.error_code ?? "venue_cost_gap_preview_failed"));
      return mapVenueCostGapPreview(result);
    },
    staleTime: 15_000,
  });
}

export function useConfirmVenueCostRuleGap() {
  const invalidate = useInvalidateVenueCosts();
  return useMutation({
    mutationFn: async (input: {
      gapFrom: string;
      gapTo: string | null;
      reason: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await supabase.rpc("confirm_venue_cost_rule_gap", {
        p_gap_from: input.gapFrom,
        p_gap_to: input.gapTo,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as RpcObject | null;
      if (!result?.success) {
        return { success: false as const, error: String(result?.error_code ?? "venue_cost_gap_confirm_failed") };
      }
      return { success: true as const, alreadyApplied: result.already_applied === true };
    },
    onSuccess: (result) => {
      if (result.success) invalidate();
    },
  });
}

function mapCloseLessonResult(
  result: RpcObject
): { success: true; closureId: string; alreadyApplied: boolean; amount?: number; currency?: string; pricingStatus?: string } | {
  success: false;
  error: string;
} {
  if (result.success !== true) {
    return { success: false, error: String(result.error_code ?? result.error ?? "close_lesson_failed") };
  }
  const mapped: {
    success: true;
    closureId: string;
    alreadyApplied: boolean;
    amount?: number;
    currency?: string;
    pricingStatus?: string;
  } = {
    success: true,
    closureId: String(result.closure_id ?? ""),
    alreadyApplied: result.already_applied === true,
    pricingStatus: nullableString(result.pricing_status) ?? undefined,
  };
  if (result.amount != null && result.amount !== "") {
    mapped.amount = Number(result.amount);
  }
  if (result.currency != null) {
    mapped.currency = String(result.currency);
  }
  return mapped;
}

export function useCloseGroupLessonOccurrence() {
  const invalidate = useInvalidateVenueCosts();
  return useMutation({
    mutationFn: async (input: {
      scheduleSlotId: string;
      occurrenceDate: string;
      confirmedAttendeeCount: number;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("close_group_lesson_occurrence", {
        p_schedule_slot_id: input.scheduleSlotId,
        p_occurrence_date: input.occurrenceDate,
        p_confirmed_attendee_count: input.confirmedAttendeeCount,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      return mapCloseLessonResult((data as RpcObject | null) ?? {});
    },
    onSuccess: (result) => {
      if (result.success) invalidate();
    },
  });
}

export function useClosePersonalLessonOccurrence() {
  const invalidate = useInvalidateVenueCosts();
  return useMutation({
    mutationFn: async (input: { personalLessonId: string; idempotencyKey?: string }) => {
      const { data, error } = await supabase.rpc("close_personal_lesson_occurrence", {
        p_personal_lesson_id: input.personalLessonId,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      return mapCloseLessonResult((data as RpcObject | null) ?? {});
    },
    onSuccess: (result) => {
      if (result.success) invalidate();
    },
  });
}

export function useReopenLessonOccurrenceClosure() {
  const invalidate = useInvalidateVenueCosts();
  return useMutation({
    mutationFn: async (input: { closureId: string; reason: string; idempotencyKey?: string }) => {
      const { data, error } = await supabase.rpc("reopen_lesson_occurrence_closure", {
        p_closure_id: input.closureId,
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as RpcObject | null;
      if (!result?.success) {
        return { success: false as const, error: String(result?.error_code ?? "reopen_lesson_failed") };
      }
      return {
        success: true as const,
        closureId: String(result.closure_id ?? input.closureId),
        alreadyApplied: result.already_applied === true,
        adjustmentId: nullableString(result.adjustment_id),
      };
    },
    onSuccess: (result) => {
      if (result.success) invalidate();
    },
  });
}

export const financeCostsQueryKey = ["finance-costs"] as const;

export interface FinanceCostEntry {
  id: string;
  sourceType: "manual_expense" | "venue_cost" | "teacher_expense";
  entryDate: string;
  amount: number;
  category: string;
  description: string;
  ruleVersionId: string | null;
  closureId: string | null;
  teacherPayRuleId: string | null;
  createdAt: string;
}

export interface FinanceCostsSummary {
  entries: FinanceCostEntry[];
  manualTotal: number;
  venueTotal: number;
  total: number;
}

export function useFinanceCosts(dateFrom: string, dateTo: string, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  return useQuery({
    queryKey: withOrgId([...financeCostsQueryKey, dateFrom, dateTo]),
    enabled: orgEnabled && enabled && Boolean(dateFrom && dateTo),
    queryFn: async (): Promise<FinanceCostsSummary> => {
      const { data, error } = await supabase.rpc("get_finance_costs", {
        p_date_from: dateFrom,
        p_date_to: dateTo,
      });
      if (error) throw error;
      const result = data as RpcObject | null;
      if (!result?.success) throw new Error(String(result?.error_code ?? "finance_costs_failed"));
      const entries = (Array.isArray(result.entries) ? result.entries : []).map((row) => {
        const item = row as RpcObject;
        return {
          id: String(item.id),
          sourceType: String(item.source_type) as FinanceCostEntry["sourceType"],
          entryDate: String(item.entry_date ?? "").slice(0, 10),
          amount: Number(item.amount) || 0,
          category: String(item.category ?? ""),
          description: String(item.description ?? ""),
          ruleVersionId: nullableString(item.rule_version_id),
          closureId: nullableString(item.closure_id),
          teacherPayRuleId: nullableString(item.teacher_pay_rule_id),
          createdAt: String(item.created_at ?? ""),
        } satisfies FinanceCostEntry;
      });
      return {
        entries,
        manualTotal: Number(result.manual_total) || 0,
        venueTotal: Number(result.venue_total) || 0,
        total: Number(result.total) || 0,
      };
    },
    staleTime: 30_000,
  });
}
