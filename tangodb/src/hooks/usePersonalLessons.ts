import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { fetchAllPostgrestRows } from "../lib/postgrestRange";
import { orgScopedQueryFilter } from "../lib/orgQueryFilter";
import { WEEKLY_RECURRENCE_SLOT_CAP } from "../lib/dateRecurrenceLimits";
import { supabase } from "../lib/supabase";
import { reportClientError } from "../lib/reportClientError";
import { isPersonalLessonLockedForWrite, normalizeTime } from "../lib/scheduleWeek";
import { formatClientName } from "../lib/utils";
import type { Client, PersonalLesson } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { useClientDirectory } from "./useClients";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { paymentsQueryKey } from "./usePayments";
import { subscriptionsQueryKey } from "./useSubscriptions";
import { financialDebtorsQueryKey } from "./useFinancialDebtors";
import { personalLessonChargesQueryKey } from "./usePersonalLessonCharges";

export const personalLessonsQueryKey = ["personalLessons"] as const;

export interface UsePersonalLessonsOptions {
  yearMonth?: string;
  dateRange?: { start: string; end: string };
  paidFilter?: "yes" | "no";
  locationId?: string;
  disciplineId?: string;
  teacherMemberId?: string;
  clientId?: string;
  attendanceStatus?: "unmarked" | "present" | "absent" | "excused";
  excludeCancelled?: boolean;
  enabled?: boolean;
}

export type DeletePersonalLessonInput = string | { id: string; lessonDate?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asId = (value: unknown): string => (value == null ? "" : String(value).trim());

const isUuid = (value: string): boolean => UUID_RE.test(value.trim());

const legacyClientLabel = (clientId: string): string => {
  const id = clientId.trim();
  if (!id || isUuid(id)) return "";
  return id;
};

const clientNameFromMap = (clientId: string, clientMap: Record<string, Client>): string => {
  const id = clientId.trim();
  if (!id) return "";
  const client = clientMap[id];
  if (client) return formatClientName(client.lastName, client.firstName);
  if (isUuid(id)) return "";
  return id;
};

const buildClientDisplay = (
  clientId1: string,
  clientId2: string,
  clientId3: string,
  clientId4: string,
  clientMap: Record<string, Client>
): string =>
  joinClientNames([
    clientNameFromMap(clientId1, clientMap),
    clientId2 ? clientNameFromMap(clientId2, clientMap) : "",
    clientId3 ? clientNameFromMap(clientId3, clientMap) : "",
    clientId4 ? clientNameFromMap(clientId4, clientMap) : "",
  ]);

const enrichLessonClientDisplay = (
  lesson: PersonalLesson,
  clientMap: Record<string, Client>
): PersonalLesson => {
  const fromDirectory = buildClientDisplay(
    lesson.clientId1,
    lesson.clientId2,
    lesson.clientId3,
    lesson.clientId4 ?? "",
    clientMap
  );
  if (fromDirectory !== "schedule.lessonInfo.clientNotSpecified") {
    return { ...lesson, clientDisplay: fromDirectory };
  }

  const joinDisplay = lesson.clientDisplay.trim();
  if (joinDisplay && joinDisplay !== "schedule.lessonInfo.clientNotSpecified" && !isUuid(joinDisplay.split(" & ")[0] ?? "")) {
    return lesson;
  }

  return { ...lesson, clientDisplay: fromDirectory };
};

const joinClientNames = (parts: string[]): string =>
  parts.filter(Boolean).join(" & ") || "schedule.lessonInfo.clientNotSpecified";

const mapPersonalLesson = (row: Record<string, unknown>, maskFinancial: boolean): PersonalLesson => {
  const clientId1 = asId(row.client_id1);
  const clientId2 = asId(row.client_id2);
  const clientId3 = asId(row.client_id3);
  const clientId4 = asId(row.client_id4);

  return {
    id: row.id as string,
    type: row.type as string,
    clientId1,
    clientId2,
    clientId3,
    clientId4: clientId4 || undefined,
    clientDisplay: joinClientNames([
      legacyClientLabel(clientId1),
      legacyClientLabel(clientId2),
      legacyClientLabel(clientId3),
      legacyClientLabel(clientId4),
    ]),
    date: String(row.date ?? "").slice(0, 10),
    timeStart: normalizeTime((row.time_start as string) || "14:00"),
    timeEnd: normalizeTime((row.time_end as string) || "15:00"),
    price: maskFinancial ? 0 : Number(row.price) || 0,
    paid: (row.paid as "yes" | "no" | undefined) ?? "no",
    paidAmount: maskFinancial ? 0 : Number(row.paid_amount) || 0,
    disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
    subscriptionId: row.subscription_id != null ? (row.subscription_id as string) : null,
    locationId: row.location_id != null ? String(row.location_id) : null,
    teacherMemberId: row.teacher_member_id != null ? String(row.teacher_member_id) : null,
    attendanceStatus: (row.attendance_status as "present" | "absent" | "excused" | null) ?? null,
    priceId: row.price_id != null ? String(row.price_id) : null,
    payerClientId: row.payer_client_id != null ? String(row.payer_client_id) : null,
    billingSplitMode:
      row.billing_split_mode === "equal"
        ? "equal"
        : "single_payer",
  };
};

const personalLessonsSelect =
  "id, type, client_id1, client_id2, client_id3, client_id4, discipline_id, date, time_start, time_end, price, paid, paid_amount, subscription_id, location_id, teacher_member_id, attendance_status, price_id, payer_client_id, billing_split_mode";

const personalLessonsSelectTeacher =
  "id, type, client_id1, client_id2, client_id3, client_id4, discipline_id, date, time_start, time_end, paid, subscription_id, location_id, teacher_member_id, attendance_status";

function buildQueryKeySuffix(options: UsePersonalLessonsOptions): Record<string, unknown> | null {
  const suffix = {
    range: options.dateRange ?? null,
    yearMonth: options.yearMonth ?? null,
    paid: options.paidFilter ?? null,
    locationId: options.locationId ?? null,
    disciplineId: options.disciplineId ?? null,
    teacherMemberId: options.teacherMemberId ?? null,
    clientId: options.clientId ?? null,
    attendanceStatus: options.attendanceStatus ?? null,
    excludeCancelled: options.excludeCancelled ?? null,
  };

  const hasFilter = Object.values(suffix).some((value) => value != null);
  return hasFilter ? suffix : null;
}

function invalidatePersonalLessonRelatedQueries(
  queryClient: QueryClient,
  organizationId: string | null | undefined,
  options?: { refetchType?: "active"; includePayments?: boolean }
) {
  const opts = options?.refetchType ? { refetchType: options.refetchType } : undefined;
  void queryClient.invalidateQueries({ ...orgScopedQueryFilter(personalLessonsQueryKey, organizationId), ...opts });
  void queryClient.invalidateQueries({ queryKey: ["schedule"], ...opts });
  void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey, ...opts });
  void queryClient.invalidateQueries({ queryKey: financialDebtorsQueryKey, ...opts });
  void queryClient.invalidateQueries({ queryKey: personalLessonChargesQueryKey, ...opts });
  void queryClient.invalidateQueries({
    ...orgScopedQueryFilter(["google-calendar", "entry-sync-status"], organizationId),
    ...opts,
  });
  if (options?.includePayments !== false) {
    void queryClient.invalidateQueries({ queryKey: paymentsQueryKey, ...opts });
  }
}

function resolveDeleteInput(input: DeletePersonalLessonInput): { id: string; lessonDate?: string } {
  if (typeof input === "string") return { id: input };
  return input;
}

function overlapErrorMessage(error: { message: string }): string | null {
  if (error.message.includes("personal_lesson_overlap") || error.message.includes("personal_group_overlap")) {
    return "hooks.error.personalOverlap";
  }
  return null;
}

export function usePersonalLessons(options?: UsePersonalLessonsOptions) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role } = useOrganization();
  const maskFinancial = role === "teacher";
  const resolved = options ?? {};
  const queryEnabled = orgEnabled && (resolved.enabled ?? true);
  const keySuffix = buildQueryKeySuffix(resolved);
  const clientsQuery = useClientDirectory({ enabled: queryEnabled });

  const lessonsQuery = useQuery({
    queryKey: withOrgId([...personalLessonsQueryKey, keySuffix, { maskFinancial }]),
    enabled: queryEnabled,
    queryFn: async () => {
      const selectColumns = maskFinancial ? personalLessonsSelectTeacher : personalLessonsSelect;
      const useTeacherView = maskFinancial && resolved.excludeCancelled !== true;

      const data = useTeacherView
        ? await fetchAllPostgrestRows((from, to) => {
            let query = supabase
              .from("personal_lessons_teacher_v")
              .select(selectColumns)
              .order("date", { ascending: false });

            if (resolved.dateRange) {
              query = query
                .gte("date", resolved.dateRange.start)
                .lte("date", resolved.dateRange.end);
            } else if (resolved.yearMonth) {
              const [y, m] = resolved.yearMonth.split("-").map(Number);
              const start = `${y}-${String(m).padStart(2, "0")}-01`;
              const lastDay = new Date(y, m, 0).getDate();
              const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
              query = query.gte("date", start).lte("date", end);
            }

            if (resolved.paidFilter) {
              query = query.eq("paid", resolved.paidFilter);
            }

            if (resolved.locationId) {
              query = query.eq("location_id", resolved.locationId);
            }

            if (resolved.teacherMemberId) {
              query = query.eq("teacher_member_id", resolved.teacherMemberId);
            }

            if (resolved.disciplineId) {
              query = query.eq("discipline_id", resolved.disciplineId);
            }

            if (resolved.attendanceStatus === "unmarked") {
              query = query.is("attendance_status", null);
            } else if (resolved.attendanceStatus) {
              query = query.eq("attendance_status", resolved.attendanceStatus);
            }

            if (resolved.clientId) {
              const clientId = resolved.clientId;
              query = query.or(
                `client_id1.eq.${clientId},client_id2.eq.${clientId},client_id3.eq.${clientId},client_id4.eq.${clientId}`
              );
            }

            return query.range(from, to);
          })
        : await fetchAllPostgrestRows((from, to) => {
            let query = supabase
              .from("personal_lessons")
              .select(selectColumns)
              .order("date", { ascending: false });

            if (resolved.excludeCancelled) {
              query = query.is("cancelled_at", null);
            }

            if (resolved.dateRange) {
              query = query
                .gte("date", resolved.dateRange.start)
                .lte("date", resolved.dateRange.end);
            } else if (resolved.yearMonth) {
              const [y, m] = resolved.yearMonth.split("-").map(Number);
              const start = `${y}-${String(m).padStart(2, "0")}-01`;
              const lastDay = new Date(y, m, 0).getDate();
              const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
              query = query.gte("date", start).lte("date", end);
            }

            if (resolved.paidFilter) {
              query = query.eq("paid", resolved.paidFilter);
            }

            if (resolved.locationId) {
              query = query.eq("location_id", resolved.locationId);
            }

            if (resolved.teacherMemberId) {
              query = query.eq("teacher_member_id", resolved.teacherMemberId);
            }

            if (resolved.disciplineId) {
              query = query.eq("discipline_id", resolved.disciplineId);
            }

            if (resolved.attendanceStatus === "unmarked") {
              query = query.is("attendance_status", null);
            } else if (resolved.attendanceStatus) {
              query = query.eq("attendance_status", resolved.attendanceStatus);
            }

            if (resolved.clientId) {
              const clientId = resolved.clientId;
              query = query.or(
                `client_id1.eq.${clientId},client_id2.eq.${clientId},client_id3.eq.${clientId},client_id4.eq.${clientId}`
              );
            }

            return query.range(from, to);
          });

      return data.map((row) =>
        mapPersonalLesson(row as unknown as Record<string, unknown>, maskFinancial)
      );
    },
    staleTime: 30 * 1000,
  });

  const data = useMemo(() => {
    const lessons = lessonsQuery.data ?? [];
    const clientMap = Object.fromEntries((clientsQuery.data ?? []).map((c) => [c.id, c]));
    return lessons.map((lesson) => enrichLessonClientDisplay(lesson, clientMap));
  }, [lessonsQuery.data, clientsQuery.data]);

  return {
    ...lessonsQuery,
    data,
    isLoading: lessonsQuery.isLoading || clientsQuery.isLoading,
    isError: lessonsQuery.isError || clientsQuery.isError,
    error: lessonsQuery.error ?? clientsQuery.error,
  };
}

export function useAddPersonalLessons() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({
      requireScope = false,
      type,
      clientId1,
      clientId2,
      clientId3,
      clientId4,
      dates,
      timeStart,
      timeEnd,
      price,
      paid,
      disciplineId,
      locationId,
      teacherMemberId,
      subscriptionId,
      priceId,
      payerClientId,
      billingSplitMode,
    }: {
      requireScope?: boolean;
      type: string;
      clientId1: string;
      clientId2: string;
      clientId3: string;
      clientId4?: string;
      dates: string[];
      timeStart: string;
      timeEnd: string;
      price: number;
      paid: boolean;
      disciplineId: string;
      locationId?: string;
      teacherMemberId?: string;
      subscriptionId?: string;
      priceId?: string | null;
      payerClientId?: string | null;
      billingSplitMode?: "single_payer" | "equal";
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      if (requireScope && (!locationId || !teacherMemberId)) {
        return { success: false as const, error: "hooks.error.locationTeacherRequired" };
      }

      if (!dates.length) {
        return { success: false as const, error: "hooks.error.bookingDatesRequired" };
      }

      if (dates.length > WEEKLY_RECURRENCE_SLOT_CAP) {
        return { success: false as const, error: "hooks.error.bookingDatesTooMany" };
      }

      const paidValue = subscriptionId || paid ? "yes" : "no";
      const rows = dates.map((date) => ({
        id: crypto.randomUUID(),
        organization_id: organizationId,
        type,
        client_id1: clientId1 || null,
        client_id2: clientId2 || null,
        client_id3: clientId3 || null,
        client_id4: clientId4 || null,
        date,
        time_start: normalizeTime(timeStart),
        time_end: normalizeTime(timeEnd),
        price: subscriptionId ? 0 : price,
        paid: paidValue,
        discipline_id: disciplineId,
        location_id: locationId ?? null,
        teacher_member_id: teacherMemberId ?? null,
        subscription_id: subscriptionId || null,
        price_id: subscriptionId ? null : (priceId ?? null),
        payer_client_id: payerClientId ?? null,
        billing_split_mode: billingSplitMode ?? "single_payer",
      }));

      const { error } = await supabase.from("personal_lessons").insert(rows);
      if (error) {
        const overlap = overlapErrorMessage(error);
        if (overlap) return { success: false as const, error: overlap };
        return { success: false as const, error: error.message };
      }
      return { success: true as const, ids: rows.map((row) => row.id as string) };
    },
    onSuccess: (result) => {
      if (result.success) {
        invalidatePersonalLessonRelatedQueries(queryClient, organizationId, { includePayments: false });
      }
    },
  });
}

export function useDeletePersonalLesson() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  const { membership } = useOrganization();
  const canEditPastSchedule = membership?.meta?.can_edit_past_schedule ?? false;

  return useMutation({
    mutationFn: async (input: DeletePersonalLessonInput) => {
      const { id, lessonDate } = resolveDeleteInput(input);

      if (lessonDate && isPersonalLessonLockedForWrite(lessonDate, canEditPastSchedule)) {
        return { success: false as const, error: "hooks.error.pastLessonDelete" };
      }

      const { data, error } = await supabase.rpc("delete_personal_lesson", {
        p_lesson_id: id,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "personal.error.deleteFailed" };
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidatePersonalLessonRelatedQueries(queryClient, organizationId, { refetchType: "active" });
    },
  });
}

export function useDeletePersonalLessonSeriesFromDate() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  const { membership } = useOrganization();
  const canEditPastSchedule = membership?.meta?.can_edit_past_schedule ?? false;

  return useMutation({
    mutationFn: async (input: DeletePersonalLessonInput) => {
      const { id, lessonDate } = resolveDeleteInput(input);

      if (lessonDate && isPersonalLessonLockedForWrite(lessonDate, canEditPastSchedule)) {
        return { success: false as const, error: "hooks.error.pastLessonDelete" };
      }

      const { data, error } = await supabase.rpc("delete_personal_lesson_series_from_date", {
        p_lesson_id: id,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; deleted_count?: number } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "personal.error.deleteFailed" };
      }

      return { success: true as const, deletedCount: result.deleted_count ?? 0 };
    },
    onSuccess: (result) => {
      if (result.success) invalidatePersonalLessonRelatedQueries(queryClient, organizationId, { refetchType: "active" });
    },
  });
}

export function useUpdatePersonalLesson() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  const { membership } = useOrganization();
  const canEditPastSchedule = membership?.meta?.can_edit_past_schedule ?? false;

  return useMutation({
    mutationFn: async ({
      id,
      lessonDate,
      date,
      timeStart,
      timeEnd,
      locationId,
      teacherMemberId,
      disciplineId,
      type,
      clientId1,
      clientId2,
      clientId3,
      clientId4,
      price,
      paid,
      subscriptionId,
      priceId,
      payerClientId,
      billingSplitMode,
    }: {
      id: string;
      lessonDate?: string;
      date?: string;
      timeStart?: string;
      timeEnd?: string;
      locationId?: string | null;
      teacherMemberId?: string | null;
      disciplineId?: string | null;
      type?: string;
      clientId1?: string;
      clientId2?: string;
      clientId3?: string;
      clientId4?: string;
      price?: number;
      paid?: boolean;
      subscriptionId?: string | null;
      priceId?: string | null;
      payerClientId?: string | null;
      billingSplitMode?: "single_payer" | "equal";
    }) => {
      const currentDate = lessonDate;
      if (currentDate && isPersonalLessonLockedForWrite(currentDate, canEditPastSchedule)) {
        return {
          success: false as const,
          error: "hooks.error.pastLessonEdit",
        };
      }

      if (date && isPersonalLessonLockedForWrite(date, canEditPastSchedule)) {
        return { success: false as const, error: "schedule.error.moveToPast" };
      }

      const payload: Record<string, unknown> = {};
      if (date != null) payload.date = date;
      if (timeStart != null) payload.time_start = normalizeTime(timeStart);
      if (timeEnd != null) payload.time_end = normalizeTime(timeEnd);
      if (locationId !== undefined) payload.location_id = locationId;
      if (teacherMemberId !== undefined) payload.teacher_member_id = teacherMemberId;
      if (disciplineId !== undefined) payload.discipline_id = disciplineId;
      if (type != null) payload.type = type;
      if (clientId1 !== undefined) payload.client_id1 = clientId1 || null;
      if (clientId2 !== undefined) payload.client_id2 = clientId2 || null;
      if (clientId3 !== undefined) payload.client_id3 = clientId3 || null;
      if (clientId4 !== undefined) payload.client_id4 = clientId4 || null;
      if (price !== undefined) payload.price = price;
      if (paid !== undefined) payload.paid = paid ? "yes" : "no";
      if (subscriptionId !== undefined) payload.subscription_id = subscriptionId;
      if (priceId !== undefined) payload.price_id = priceId;
      if (payerClientId !== undefined) payload.payer_client_id = payerClientId;
      if (billingSplitMode !== undefined) payload.billing_split_mode = billingSplitMode;

      if (Object.keys(payload).length === 0) {
        return { success: false as const, error: "hooks.error.noUpdateData" };
      }

      const { data, error } = await supabase.rpc("update_personal_lesson", {
        p_lesson_id: id,
        p_payload: asJson(payload),
      });

      if (error) {
        const overlap = overlapErrorMessage(error);
        if (overlap) return { success: false as const, error: overlap };
        return { success: false as const, error: error.message };
      }

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "common.saveFailed" };
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidatePersonalLessonRelatedQueries(queryClient, organizationId);
    },
  });
}

export function useRestatePersonalLessonAmount() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (input: { lessonId: string; newAmount: number }) => {
      const { data, error } = await supabase.rpc("restate_personal_lesson_amount", {
        p_lesson_id: input.lessonId,
        p_new_amount: input.newAmount,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "finance.debtors.adjustFailed" };
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidatePersonalLessonRelatedQueries(queryClient, organizationId);
    },
  });
}

export const personalLessonDebtTraceQueryKey = ["personalLessonDebtTrace"] as const;

export type PersonalLessonDebtTraceKind =
  | "charge_created"
  | "payment"
  | "storno"
  | "billed_restated"
  | "write_off";

export interface PersonalLessonDebtTraceEvent {
  kind: PersonalLessonDebtTraceKind;
  at: string;
  amount: number;
  method: string | null;
  comment: string | null;
}

function mapDebtTraceKind(value: unknown): PersonalLessonDebtTraceKind {
  if (
    value === "charge_created" ||
    value === "payment" ||
    value === "storno" ||
    value === "billed_restated" ||
    value === "write_off"
  ) {
    return value;
  }
  return "payment";
}

function mapDebtTracePayload(raw: unknown): { events: PersonalLessonDebtTraceEvent[] } {
  const row = raw as { events?: unknown } | null;
  const events = Array.isArray(row?.events) ? row.events : [];
  return {
    events: events.map((item) => {
      const event = (item ?? {}) as Record<string, unknown>;
      return {
        kind: mapDebtTraceKind(event.kind),
        at: String(event.at ?? ""),
        amount: Number(event.amount) || 0,
        method: event.method != null ? String(event.method) : null,
        comment: event.comment != null ? String(event.comment) : null,
      };
    }),
  };
}

export function usePersonalLessonDebtTrace(
  lessonId: string | null | undefined,
  chargeId: string | null | undefined,
  options?: { enabled?: boolean }
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true) && Boolean(lessonId);

  return useQuery({
    queryKey: withOrgId([...personalLessonDebtTraceQueryKey, lessonId ?? "", chargeId ?? ""]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_personal_lesson_debt_trace", {
        p_lesson_id: lessonId as string,
        p_charge_id: chargeId ?? null,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string } | null;
      if (!result || result.success === false) {
        throw new Error(String(result?.error ?? "finance.debtors.traceFailed"));
      }
      return mapDebtTracePayload(result);
    },
    staleTime: 15 * 1000,
  });
}

export function useWriteOffPersonalLessonDebt() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (input: {
      lessonId: string;
      chargeId?: string | null;
      reasonCode?: string;
      reasonComment?: string | null;
    }) => {
      const { data, error } = await supabase.rpc("write_off_personal_lesson_debt", {
        p_lesson_id: input.lessonId,
        p_charge_id: input.chargeId ?? null,
        p_reason_code: input.reasonCode ?? "wrong_amount",
        p_reason_comment: input.reasonComment ?? null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; written_off?: number } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "finance.debtors.writeOffFailed" };
      }

      return { success: true as const, writtenOff: Number(result.written_off) || 0 };
    },
    onSuccess: (result) => {
      if (result.success) invalidatePersonalLessonRelatedQueries(queryClient, organizationId);
    },
  });
}

type MarkPersonalLessonAttendanceRollbackContext = {
  previousEntries: [QueryKey, PersonalLesson[] | undefined][];
};

export function useMarkPersonalLessonAttendance() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  const personalLessonsFilter = orgScopedQueryFilter(personalLessonsQueryKey, organizationId);

  const rollback = (context: MarkPersonalLessonAttendanceRollbackContext | undefined) => {
    if (context?.previousEntries) {
      for (const [key, data] of context.previousEntries) {
        queryClient.setQueryData(key, data);
      }
    }
  };

  return useMutation({
    mutationFn: async ({
      lessonId,
      status,
    }: {
      lessonId: string;
      status: "present" | "absent" | "excused";
    }) => {
      const { data, error } = await supabase.rpc("mark_personal_lesson_attendance", {
        p_lesson_id: lessonId,
        p_new_status: status,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "common.saveFailed" };
      }

      return { success: true as const };
    },
    onMutate: async ({ lessonId, status }) => {
      await queryClient.cancelQueries(personalLessonsFilter);

      const previousEntries = queryClient.getQueriesData<PersonalLesson[]>(personalLessonsFilter);
      queryClient.setQueriesData<PersonalLesson[]>(
        personalLessonsFilter,
        (old) =>
          (old ?? []).map((l) => (l.id === lessonId ? { ...l, attendanceStatus: status } : l))
      );

      return { previousEntries };
    },
    onError: (error, _vars, context) => {
      reportClientError(error, { area: "mutation", action: "useMarkPersonalLessonAttendance" });
      rollback(context);
    },
    onSettled: (result, _error, _vars, context) => {
      if (result?.success === false) {
        rollback(context);
        return;
      }
      if (result?.success) invalidatePersonalLessonRelatedQueries(queryClient, organizationId);
    },
  });
}
