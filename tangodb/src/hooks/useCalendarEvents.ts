import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { normalizeTime } from "../lib/scheduleWeek";
import type {
  CalendarEventPaymentStatus,
  CalendarEventType,
  EventDisplayLesson,
  PaymentMethod,
} from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { otherIncomeQueryKey } from "./useOtherIncome";
import { scheduleQueryKey } from "./useSchedule";

export const calendarEventsQueryKey = ["calendarEvents"] as const;

export interface CalendarEventSessionInput {
  sessionId?: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  locationId: string;
}

export interface CalendarEventConflictGroup {
  kind: "group";
  slotId: string;
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  locationId: string | null;
  groupName: string;
  teacherMemberId: string | null;
  disciplineId: string | null;
}

export interface CalendarEventConflictPersonal {
  kind: "personal";
  lessonId: string;
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  locationId: string | null;
  clientDisplay: string;
  teacherMemberId: string | null;
  disciplineId: string | null;
}

export interface CalendarEventConflictEvent {
  kind: "event";
  eventId: string;
  sessionId: string;
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  locationId: string | null;
  title: string;
}

export type CalendarEventConflict =
  | CalendarEventConflictGroup
  | CalendarEventConflictPersonal
  | CalendarEventConflictEvent;

function mapConflict(row: Record<string, unknown>): CalendarEventConflict {
  const kind = row.kind as string;
  if (kind === "personal") {
    return {
      kind: "personal",
      lessonId: String(row.lesson_id),
      occurrenceDate: String(row.occurrence_date).slice(0, 10),
      timeStart: normalizeTime(String(row.time_start)),
      timeEnd: normalizeTime(String(row.time_end)),
      locationId: row.location_id != null ? String(row.location_id) : null,
      clientDisplay: String(row.client_display ?? ""),
      teacherMemberId: row.teacher_member_id != null ? String(row.teacher_member_id) : null,
      disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
    };
  }
  if (kind === "event") {
    return {
      kind: "event",
      eventId: String(row.event_id),
      sessionId: String(row.session_id),
      occurrenceDate: String(row.occurrence_date).slice(0, 10),
      timeStart: normalizeTime(String(row.time_start)),
      timeEnd: normalizeTime(String(row.time_end)),
      locationId: row.location_id != null ? String(row.location_id) : null,
      title: String(row.title ?? ""),
    };
  }

  return {
    kind: "group",
    slotId: String(row.slot_id),
    occurrenceDate: String(row.occurrence_date).slice(0, 10),
    timeStart: normalizeTime(String(row.time_start)),
    timeEnd: normalizeTime(String(row.time_end)),
    locationId: row.location_id != null ? String(row.location_id) : null,
    groupName: String(row.group_name ?? ""),
    teacherMemberId: row.teacher_member_id != null ? String(row.teacher_member_id) : null,
    disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
  };
}

function sessionsToRpc(sessions: CalendarEventSessionInput[]) {
  return sessions.map((s) => ({
    session_id: s.sessionId ?? null,
    date: s.date,
    time_start: s.timeStart,
    time_end: s.timeEnd,
    location_id: s.locationId,
  }));
}

export function useCalendarEventSessions(eventId: string | null, enabled: boolean) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...calendarEventsQueryKey, "sessions", eventId]),
    enabled: orgEnabled && enabled && !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calendar_event_sessions")
        .select("id, session_date, time_start, time_end, location_id")
        .eq("event_id", eventId!)
        .order("session_date")
        .order("time_start");

      if (error) throw error;

      return (data ?? []).map(
        (row): CalendarEventSessionInput => ({
          sessionId: String(row.id),
          date: String(row.session_date).slice(0, 10),
          timeStart: normalizeTime(String(row.time_start)),
          timeEnd: normalizeTime(String(row.time_end)),
          locationId: String(row.location_id),
        })
      );
    },
    staleTime: 0,
  });
}

export function useCalendarEventConflictsPreview(
  sessions: CalendarEventSessionInput[],
  enabled: boolean,
  excludeEventId?: string
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...calendarEventsQueryKey, "conflicts", sessions, excludeEventId]),
    enabled: orgEnabled && enabled && sessions.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_calendar_event_conflicts", {
        p_sessions: sessionsToRpc(sessions),
        p_exclude_event_id: excludeEventId ?? null,
      });
      if (error) throw error;

      const result = data as {
        success?: boolean;
        error?: string;
        conflicts?: Record<string, unknown>[];
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.event.previewFailed", conflicts: [] };
      }

      return {
        success: true as const,
        conflicts: (result.conflicts ?? []).map(mapConflict),
      };
    },
    staleTime: 0,
  });
}

export interface CreateCalendarEventInput {
  idempotencyKey: string;
  title: string;
  eventType: CalendarEventType;
  comment?: string;
  guestTeacher?: string;
  organizer?: string;
  plannedGuestCount?: number | null;
  actualGuestCount?: number | null;
  incomeAmount?: number;
  paidAmount?: number;
  currency?: string;
  paymentStatus?: CalendarEventPaymentStatus;
  paymentComment?: string;
  paymentMethod?: PaymentMethod;
  sessions: CalendarEventSessionInput[];
  groupCancellations: Array<{ slotId: string; date: string }>;
  personalCancellations: Array<{ lessonId: string; reason?: string }>;
}

export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateCalendarEventInput) => {
      const { data, error } = await supabase.rpc("create_calendar_event_with_cancellations", {
        p_payload: {
          idempotency_key: input.idempotencyKey,
          title: input.title,
          event_type: input.eventType,
          comment: input.comment ?? null,
          guest_teacher: input.guestTeacher ?? null,
          organizer: input.organizer ?? null,
          planned_guest_count: input.plannedGuestCount ?? null,
          actual_guest_count: input.actualGuestCount ?? null,
          income_amount: input.incomeAmount ?? 0,
          paid_amount: input.paidAmount ?? 0,
          currency: input.currency ?? "RUB",
          payment_status: input.paymentStatus ?? "unpaid",
          payment_comment: input.paymentComment ?? null,
          payment_method: input.paymentMethod ?? "cash",
          sessions: sessionsToRpc(input.sessions),
          group_cancellations: input.groupCancellations.map((c) => ({
            slot_id: c.slotId,
            date: c.date,
          })),
          personal_cancellations: input.personalCancellations.map((c) => ({
            lesson_id: c.lessonId,
            reason: c.reason ?? "calendar_event",
          })),
        },
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        event_id?: string;
        session_count?: number;
        group_cancel_count?: number;
        personal_cancel_count?: number;
        already_applied?: boolean;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.event.createFailed" };
      }

      return {
        success: true as const,
        eventId: result.event_id ?? "",
        sessionCount: result.session_count ?? 0,
        groupCancelCount: result.group_cancel_count ?? 0,
        personalCancelCount: result.personal_cancel_count ?? 0,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: otherIncomeQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["personalLessons"], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["scheduleCancellations"], refetchType: "active" });
    },
  });
}

type CalendarEventSessionRow = {
  id: string;
  session_date: string;
  time_start: string;
  time_end: string;
  location_id: string | null;
  event_id: string;
};

function mapSessionRowToEventLesson(
  row: CalendarEventSessionRow,
  event: Record<string, unknown>,
  maskFinancial: boolean
): EventDisplayLesson {
  return {
    kind: "event",
    sessionId: String(row.id),
    eventId: String(row.event_id),
    date: String(row.session_date).slice(0, 10),
    timeStart: normalizeTime(String(row.time_start)),
    timeEnd: normalizeTime(String(row.time_end)),
    locationId: row.location_id != null ? String(row.location_id) : null,
    title: String(event.title ?? ""),
    eventType: (event.event_type as CalendarEventType) ?? "master_class",
    guestTeacher: event.guest_teacher != null ? String(event.guest_teacher) : null,
    organizer: event.organizer != null ? String(event.organizer) : null,
    comment: event.comment != null ? String(event.comment) : null,
    paymentStatus: maskFinancial
      ? "unpaid"
      : ((event.payment_status as CalendarEventPaymentStatus) ?? "unpaid"),
    incomeAmount: maskFinancial
      ? null
      : event.income_amount != null
        ? Number(event.income_amount)
        : null,
    paidAmount: maskFinancial
      ? null
      : event.paid_amount != null
        ? Number(event.paid_amount)
        : null,
    currency: maskFinancial ? "RUB" : event.currency != null ? String(event.currency) : "RUB",
    plannedGuestCount:
      event.planned_guest_count != null ? Number(event.planned_guest_count) : null,
    actualGuestCount: maskFinancial
      ? null
      : event.actual_guest_count != null
        ? Number(event.actual_guest_count)
        : null,
  };
}

export function useCalendarEventsForWeek(weekStartISO: string, weekEndISO: string, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role } = useOrganization();
  const maskFinancial = role === "teacher";

  return useQuery({
    queryKey: withOrgId([...calendarEventsQueryKey, "week", weekStartISO, { maskFinancial }]),
    enabled: orgEnabled && enabled,
    queryFn: async () => {
      const { data: sessions, error: sessionsError } = await supabase
        .from("calendar_event_sessions")
        .select("id, session_date, time_start, time_end, location_id, event_id")
        .gte("session_date", weekStartISO)
        .lte("session_date", weekEndISO)
        .order("session_date")
        .order("time_start");

      if (sessionsError) throw sessionsError;

      const sessionRows = (sessions ?? []) as CalendarEventSessionRow[];
      if (sessionRows.length === 0) return [];

      const eventIds = [...new Set(sessionRows.map((row) => String(row.event_id)))];

      if (maskFinancial) {
        const { data: events, error: eventsError } = await supabase
          .from("calendar_events_teacher_v")
          .select("id, title, event_type, guest_teacher, organizer, comment, planned_guest_count")
          .in("id", eventIds);

        if (eventsError) throw eventsError;

        const eventById = new Map(
          (events ?? []).map((event) => [String(event.id), event as Record<string, unknown>])
        );

        return sessionRows.flatMap((row) => {
          const event = eventById.get(String(row.event_id));
          if (!event) return [];
          return [mapSessionRowToEventLesson(row, event, true)];
        });
      }

      const { data: events, error: eventsError } = await supabase
        .from("calendar_events")
        .select(
          "id, title, event_type, guest_teacher, organizer, comment, payment_status, income_amount, paid_amount, currency, planned_guest_count, actual_guest_count"
        )
        .in("id", eventIds);

      if (eventsError) throw eventsError;

      const eventById = new Map(
        (events ?? []).map((event) => [String(event.id), event as Record<string, unknown>])
      );

      return sessionRows.flatMap((row) => {
        const event = eventById.get(String(row.event_id));
        if (!event) return [];
        return [mapSessionRowToEventLesson(row, event, false)];
      });
    },
    staleTime: 60 * 1000,
  });
}

export function conflictKey(conflict: CalendarEventConflict): string {
  if (conflict.kind === "group") {
    return `group:${conflict.slotId}:${conflict.occurrenceDate}`;
  }
  if (conflict.kind === "event") {
    return `event:${conflict.sessionId}:${conflict.occurrenceDate}`;
  }
  return `personal:${conflict.lessonId}`;
}

function sessionsEqual(a: CalendarEventSessionInput[], b: CalendarEventSessionInput[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (s: CalendarEventSessionInput) =>
    `${s.sessionId ?? ""}|${s.date}|${s.timeStart}|${s.timeEnd}|${s.locationId}`;
  const sa = [...a].map(norm).sort();
  const sb = [...b].map(norm).sort();
  return sa.every((v, i) => v === sb[i]);
}

export interface UpdateCalendarEventWithCancellationsInput extends UpdateCalendarEventInput {
  sessions: CalendarEventSessionInput[];
  groupCancellations: Array<{ slotId: string; date: string }>;
  personalCancellations: Array<{ lessonId: string; reason?: string }>;
}

export function useUpdateCalendarEventWithCancellations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateCalendarEventWithCancellationsInput) => {
      const { data, error } = await supabase.rpc("update_calendar_event_with_cancellations", {
        p_event_id: input.eventId,
        p_payload: {
          title: input.title,
          event_type: input.eventType,
          comment: input.comment ?? null,
          guest_teacher: input.guestTeacher ?? null,
          organizer: input.organizer ?? null,
          planned_guest_count: input.plannedGuestCount ?? null,
          actual_guest_count: input.actualGuestCount ?? null,
          income_amount: input.incomeAmount,
          payment_comment: input.paymentComment ?? null,
          sessions: sessionsToRpc(input.sessions),
          group_cancellations: input.groupCancellations.map((c) => ({
            slot_id: c.slotId,
            date: c.date,
          })),
          personal_cancellations: input.personalCancellations.map((c) => ({
            lesson_id: c.lessonId,
            reason: c.reason ?? "calendar_event",
          })),
        },
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        session_count?: number;
        group_cancel_count?: number;
        personal_cancel_count?: number;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.event.updateFailed" };
      }

      return {
        success: true as const,
        sessionCount: result.session_count ?? 0,
        groupCancelCount: result.group_cancel_count ?? 0,
        personalCancelCount: result.personal_cancel_count ?? 0,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["personalLessons"], refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["scheduleCancellations"], refetchType: "active" });
    },
  });
}

export { sessionsEqual };

export interface UpdateCalendarEventInput {
  eventId: string;
  title: string;
  eventType: CalendarEventType;
  comment?: string;
  guestTeacher?: string;
  organizer?: string;
  plannedGuestCount?: number | null;
  actualGuestCount?: number | null;
  incomeAmount?: number;
  paymentComment?: string;
}

export function useUpdateCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpdateCalendarEventInput) => {
      const { data, error } = await supabase.rpc("update_calendar_event", {
        p_event_id: input.eventId,
        p_payload: {
          title: input.title,
          event_type: input.eventType,
          comment: input.comment ?? null,
          guest_teacher: input.guestTeacher ?? null,
          organizer: input.organizer ?? null,
          planned_guest_count: input.plannedGuestCount ?? null,
          actual_guest_count: input.actualGuestCount ?? null,
          income_amount: input.incomeAmount,
          payment_comment: input.paymentComment ?? null,
        },
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.event.updateFailed" };
      }

      return { success: true as const };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey, refetchType: "active" });
    },
  });
}

export interface RecordCalendarEventPaymentInput {
  eventId: string;
  amount: number;
  method: PaymentMethod;
  methodComment?: string;
  idempotencyKey: string;
}

export function useRecordCalendarEventPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RecordCalendarEventPaymentInput) => {
      const { data, error } = await supabase.rpc("record_calendar_event_payment", {
        p_event_id: input.eventId,
        p_amount: input.amount,
        p_method: input.method,
        p_method_comment: input.methodComment ?? null,
        p_idempotency_key: input.idempotencyKey,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        paid_amount?: number;
        payment_status?: CalendarEventPaymentStatus;
        already_applied?: boolean;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.event.paymentFailed" };
      }

      return {
        success: true as const,
        paidAmount: result.paid_amount,
        paymentStatus: result.payment_status,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: otherIncomeQueryKey, refetchType: "active" });
      void queryClient.invalidateQueries({ queryKey: ["payments"], refetchType: "active" });
    },
  });
}
