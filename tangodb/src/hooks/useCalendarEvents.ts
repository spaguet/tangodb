import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { normalizeTime } from "../lib/scheduleWeek";
import type {
  CalendarEventPaymentStatus,
  CalendarEventType,
  EventDisplayLesson,
  PaymentMethod,
} from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { otherIncomeQueryKey } from "./useOtherIncome";
import { scheduleQueryKey } from "./useSchedule";

export const calendarEventsQueryKey = ["calendarEvents"] as const;

export interface CalendarEventSessionInput {
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

export type CalendarEventConflict = CalendarEventConflictGroup | CalendarEventConflictPersonal;

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
    date: s.date,
    time_start: s.timeStart,
    time_end: s.timeEnd,
    location_id: s.locationId,
  }));
}

export function useCalendarEventConflictsPreview(
  sessions: CalendarEventSessionInput[],
  enabled: boolean
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...calendarEventsQueryKey, "conflicts", sessions]),
    enabled: orgEnabled && enabled && sessions.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_calendar_event_conflicts", {
        p_sessions: sessionsToRpc(sessions),
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

export function useCalendarEventsForWeek(weekStartISO: string, weekEndISO: string, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...calendarEventsQueryKey, "week", weekStartISO]),
    enabled: orgEnabled && enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("calendar_event_sessions")
        .select(
          `
          id,
          session_date,
          time_start,
          time_end,
          location_id,
          event_id,
          calendar_events (
            id,
            title,
            event_type,
            guest_teacher,
            organizer,
            comment,
            payment_status,
            income_amount,
            paid_amount,
            currency,
            planned_guest_count,
            actual_guest_count
          )
        `
        )
        .gte("session_date", weekStartISO)
        .lte("session_date", weekEndISO)
        .order("session_date")
        .order("time_start");

      if (error) throw error;

      const lessons: EventDisplayLesson[] = [];

      for (const row of data ?? []) {
        const eventRaw = row.calendar_events as Record<string, unknown> | Record<string, unknown>[] | null;
        const event = (Array.isArray(eventRaw) ? eventRaw[0] : eventRaw) as Record<string, unknown> | null;
        if (!event) continue;

        lessons.push({
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
          paymentStatus: (event.payment_status as CalendarEventPaymentStatus) ?? "unpaid",
          incomeAmount: event.income_amount != null ? Number(event.income_amount) : null,
          paidAmount: event.paid_amount != null ? Number(event.paid_amount) : null,
          currency: event.currency != null ? String(event.currency) : "RUB",
          plannedGuestCount:
            event.planned_guest_count != null ? Number(event.planned_guest_count) : null,
          actualGuestCount:
            event.actual_guest_count != null ? Number(event.actual_guest_count) : null,
        });
      }

      return lessons;
    },
    staleTime: 60 * 1000,
  });
}

export function conflictKey(conflict: CalendarEventConflict): string {
  if (conflict.kind === "group") {
    return `group:${conflict.slotId}:${conflict.occurrenceDate}`;
  }
  return `personal:${conflict.lessonId}`;
}
