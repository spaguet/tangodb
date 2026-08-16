import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  addDays,
  expandSlotsToWeek,
  nextOccurrenceOnOrAfter,
  normalizeTime,
  toISODateLocal,
} from "../lib/scheduleWeek";
import type { DisplayLesson, GroupDisplayLesson, PersonalDisplayLesson, ScheduleSlot, EventDisplayLesson, RentalDisplayLesson } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { usePersonalLessons, personalLessonsQueryKey } from "./usePersonalLessons";
import { usePersonalLessonsModuleEnabled } from "./useOrgModules";
import { useCalendarEventsForWeek, calendarEventsQueryKey } from "./useCalendarEvents";
import { useRentalsForWeek, rentalsQueryKey } from "./useRentals";
import { scheduleGroupsQueryKey } from "./useScheduleGroups";
import { groupCapacityQueryKey } from "./useGroupCapacity";

export const scheduleQueryKey = ["schedule"] as const;

const mapScheduleSlot = (row: Record<string, unknown>): ScheduleSlot => ({
  id: row.id != null ? String(row.id) : undefined,
  dayOfWeek: row.day_of_week as number,
  time: normalizeTime(row.time as string),
  timeEnd: normalizeTime((row.time_end as string) || "21:00"),
  disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
  groupName: ((row.group_name as string) || "").trim() || undefined,
  scheduleGroupId: row.class_id != null ? String(row.class_id) : null,
  locationId: row.location_id != null ? String(row.location_id) : null,
  teacherMemberId: row.teacher_member_id != null ? String(row.teacher_member_id) : null,
  validFrom: String(row.valid_from ?? "2000-01-01").slice(0, 10),
  validTo: row.valid_to != null ? String(row.valid_to).slice(0, 10) : null,
  movedFromSlotId: row.moved_from_slot_id != null ? String(row.moved_from_slot_id) : null,
  movedFromDate: row.moved_from_date != null ? String(row.moved_from_date).slice(0, 10) : null,
  movedFromTime: row.moved_from_time != null ? normalizeTime(String(row.moved_from_time)) : null,
});

const scheduleTable = "schedule_slots" as const;

export interface ScheduleDayInput {
  dayOfWeek: number;
  time: string;
  timeEnd: string;
  validFrom?: string;
  validTo?: string | null;
}

export interface GroupScheduleSlotInput {
  id?: string;
  dayOfWeek: number;
  time: string;
  timeEnd: string;
}

/** @deprecated alias */
export type DisciplineScheduleSlotInput = GroupScheduleSlotInput;

export interface ScheduleForWeekData {
  slots: ScheduleSlot[];
  groupLessons: GroupDisplayLesson[];
  personalLessons: PersonalDisplayLesson[];
  eventLessons: EventDisplayLesson[];
  rentalLessons: RentalDisplayLesson[];
  lessons: DisplayLesson[];
}

export function useSchedule(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(scheduleQueryKey),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(scheduleTable)
        .select("*")
        .order("day_of_week")
        .order("time");
      if (error) throw error;
      return (data ?? []).map(mapScheduleSlot);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useScheduleForWeek(
  weekStart: Date,
  weekEnd: Date,
  options?: { enabled?: boolean }
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const weekStartISO = toISODateLocal(weekStart);
  const weekEndISO = toISODateLocal(weekEnd);
  const queryEnabled = orgEnabled && (options?.enabled ?? true);
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();

  const personalQuery = usePersonalLessons({
    dateRange: { start: weekStartISO, end: weekEndISO },
    enabled: queryEnabled && personalLessonsEnabled,
    excludeCancelled: true,
  });

  const eventsQuery = useCalendarEventsForWeek(weekStartISO, weekEndISO, queryEnabled);
  const rentalsQuery = useRentalsForWeek(weekStartISO, weekEndISO, queryEnabled);

  const scheduleQuery = useQuery({
    queryKey: withOrgId(["schedule", "week", weekStartISO]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(scheduleTable)
        .select("*")
        .lte("valid_from", weekEndISO)
        .or(`valid_to.is.null,valid_to.gte.${weekStartISO}`)
        .order("day_of_week")
        .order("time");
      if (error) throw error;
      return (data ?? []).map(mapScheduleSlot);
    },
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const data = useMemo((): ScheduleForWeekData | undefined => {
    if (!scheduleQuery.data) return undefined;

    const slots = scheduleQuery.data;
    const groupLessons = expandSlotsToWeek(slots, weekStart, weekEnd);
    const personalLessons: PersonalDisplayLesson[] = (personalQuery.data ?? []).map((lesson) => ({
      kind: "personal" as const,
      lessonId: lesson.id,
      date: lesson.date,
      timeStart: normalizeTime(lesson.timeStart),
      timeEnd: normalizeTime(lesson.timeEnd),
      paid: lesson.paid,
      disciplineId: lesson.disciplineId ?? null,
      locationId: lesson.locationId ?? null,
      teacherMemberId: lesson.teacherMemberId ?? null,
      clientId1: lesson.clientId1 || undefined,
      clientId2: lesson.clientId2 || undefined,
      clientId3: lesson.clientId3 || undefined,
      clientId4: lesson.clientId4 || undefined,
      clientDisplay: lesson.clientDisplay,
      priceId: lesson.priceId ?? null,
      payerClientId: lesson.payerClientId ?? null,
      subscriptionId: lesson.subscriptionId ?? null,
      price: lesson.price,
      paidAmount: lesson.paidAmount,
    }));

    const eventLessons = eventsQuery.data ?? [];
    const rentalLessons = rentalsQuery.data ?? [];

    return {
      slots,
      groupLessons,
      personalLessons,
      eventLessons,
      rentalLessons,
      lessons: [...groupLessons, ...personalLessons, ...eventLessons, ...rentalLessons],
    };
  }, [scheduleQuery.data, personalQuery.data, eventsQuery.data, rentalsQuery.data, weekStart, weekEnd]);

  return {
    ...scheduleQuery,
    data,
    isLoading:
      scheduleQuery.isLoading ||
      (personalLessonsEnabled && personalQuery.isLoading) ||
      eventsQuery.isLoading ||
      rentalsQuery.isLoading,
    isError: scheduleQuery.isError || personalQuery.isError || eventsQuery.isError || rentalsQuery.isError,
    error: scheduleQuery.error ?? personalQuery.error ?? eventsQuery.error ?? rentalsQuery.error,
  };
}

function invalidateScheduleQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: calendarEventsQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["scheduleCancellations"], refetchType: "active" });
}

/** Закрыть слот с даты closingDate (не показывать с closingDate); при valid_from === closingDate — hard delete. */
async function closeScheduleSlotByDate(
  id: string,
  closingDate: string
): Promise<{ success: true } | { success: false; error: string }> {
  const { data: slot, error: fetchError } = await supabase
    .from(scheduleTable)
    .select("valid_from")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return { success: false as const, error: fetchError.message };
  if (!slot) return { success: false as const, error: "schedule.error.slotNotFound" };

  const validFrom = String(slot.valid_from ?? "2000-01-01").slice(0, 10);
  const validTo = addDays(closingDate, -1);

  if (validTo < validFrom) {
    const { error } = await supabase.from(scheduleTable).delete().eq("id", id);
    if (error) return { success: false as const, error: error.message };
    return { success: true as const };
  }

  const { error } = await supabase.from(scheduleTable).update({ valid_to: validTo }).eq("id", id);
  if (error) return { success: false as const, error: error.message };
  return { success: true as const };
}

export function useAddGroupSchedule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({
      groupName,
      disciplineId,
      locationId,
      teacherMemberId,
      days,
      maxCapacity,
    }: {
      groupName: string;
      disciplineId: string;
      locationId: string;
      teacherMemberId: string;
      days: ScheduleDayInput[];
      maxCapacity?: number | null;
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const trimmedGroup = groupName.trim();
      if (!trimmedGroup) {
        return { success: false as const, error: "schedule.error.groupName" };
      }
      if (!locationId) {
        return { success: false as const, error: "schedule.error.location" };
      }
      if (!teacherMemberId) {
        return { success: false as const, error: "schedule.error.teacher" };
      }
      if (days.length === 0) {
        return { success: false as const, error: "schedule.error.addDayTime" };
      }

      const today = toISODateLocal(new Date());
      const rows = days.map((day) => {
        const validFrom = day.validFrom ?? nextOccurrenceOnOrAfter(today, day.dayOfWeek);
        const validTo = day.validTo !== undefined ? day.validTo : null;
        return {
          organization_id: organizationId,
          day_of_week: day.dayOfWeek,
          time: normalizeTime(day.time),
          time_end: normalizeTime(day.timeEnd),
          discipline_id: disciplineId,
          group_name: trimmedGroup,
          location_id: locationId,
          teacher_member_id: teacherMemberId,
          valid_from: validFrom,
          valid_to: validTo,
        };
      });

      const { data, error } = await supabase.from(scheduleTable).insert(rows).select("class_id");
      if (error) {
        if (error.code === "23505") {
          return { success: false as const, error: "schedule.error.duplicateSlot" };
        }
        if (error.message.includes("schedule_slot_overlap")) {
          return { success: false as const, error: "schedule.error.groupOverlap" };
        }
        return { success: false as const, error: error.message };
      }

      const classId = data?.[0]?.class_id != null ? String(data[0].class_id) : null;
      if (classId && maxCapacity != null) {
        const { data: capacityData, error: capacityError } = await supabase.rpc("update_class_max_capacity", {
          p_class_id: classId,
          p_max_capacity: maxCapacity,
        });
        if (capacityError) {
          return { success: false as const, error: capacityError.message };
        }
        const capacityResult = capacityData as { success?: boolean; error?: string } | null;
        if (!capacityResult?.success) {
          return {
            success: false as const,
            error: capacityResult?.error ?? "groupCapacity.error.updateFailed",
          };
        }
      }

      return { success: true as const, classId };
    },
    onSuccess: (result) => {
      if (result.success) {
        invalidateScheduleQueries(queryClient);
        if ("classId" in result && result.classId) {
          void queryClient.invalidateQueries({ queryKey: scheduleGroupsQueryKey });
          void queryClient.invalidateQueries({ queryKey: groupCapacityQueryKey });
        }
      }
    },
  });
}

function mapScheduleMutationError(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "schedule.error.duplicateSlot";
  if (error.message.includes("schedule_slot_overlap")) return "schedule.error.groupOverlap";
  return error.message;
}

async function findActiveSuccessorSlotId(
  organizationId: string,
  editDate: string,
  dayOfWeek: number,
  locationId: string | null
): Promise<string | null> {
  const newValidFrom = editDate;
  let query = supabase
    .from(scheduleTable)
    .select("id")
    .eq("organization_id", organizationId)
    .eq("day_of_week", dayOfWeek)
    .eq("valid_from", newValidFrom)
    .is("valid_to", null);

  if (locationId) {
    query = query.eq("location_id", locationId);
  } else {
    query = query.is("location_id", null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.id != null ? String(data.id) : null;
}

export function useUpdateGroupScheduleMetadata() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      slotIds,
      groupName,
      disciplineId,
      teacherMemberId,
    }: {
      slotIds: string[];
      groupName: string;
      disciplineId: string;
      teacherMemberId: string | null;
    }) => {
      if (slotIds.length === 0) {
        return { success: false as const, error: "schedule.error.slotNotFound" };
      }

      const { error } = await supabase
        .from(scheduleTable)
        .update({
          group_name: groupName.trim(),
          discipline_id: disciplineId,
          teacher_member_id: teacherMemberId,
        })
        .in("id", slotIds)
        .is("valid_to", null);

      if (error) {
        return { success: false as const, error: mapScheduleMutationError(error) };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

export function useEditGroupSchedule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({
      slotId,
      editDate,
      dayOfWeek,
      time,
      timeEnd,
      groupName,
      disciplineId,
      locationId,
      teacherMemberId,
    }: {
      slotId: string;
      editDate: string;
      dayOfWeek: number;
      time: string;
      timeEnd: string;
      groupName: string;
      disciplineId: string;
      locationId: string | null;
      teacherMemberId: string | null;
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const trimmedGroup = groupName.trim();
      const newValidFrom = editDate;
      const versionPayload = {
        day_of_week: dayOfWeek,
        time: normalizeTime(time),
        time_end: normalizeTime(timeEnd),
        group_name: trimmedGroup,
        discipline_id: disciplineId,
        location_id: locationId,
        teacher_member_id: teacherMemberId,
      };

      const { data: existing, error: fetchError } = await supabase
        .from(scheduleTable)
        .select("valid_to")
        .eq("id", slotId)
        .maybeSingle();

      if (fetchError) {
        return { success: false as const, error: fetchError.message };
      }
      if (!existing) {
        return { success: false as const, error: "schedule.error.slotNotFound" };
      }

      const existingValidTo =
        existing.valid_to != null ? String(existing.valid_to).slice(0, 10) : null;

      if (existingValidTo != null) {
        const successorId = await findActiveSuccessorSlotId(
          organizationId,
          editDate,
          dayOfWeek,
          locationId
        );

        if (successorId) {
          const { error: updateError } = await supabase
            .from(scheduleTable)
            .update(versionPayload)
            .eq("id", successorId);

          if (updateError) {
            return { success: false as const, error: mapScheduleMutationError(updateError) };
          }
          return { success: true as const };
        }

        const { error: insertError } = await supabase.from(scheduleTable).insert({
          organization_id: organizationId,
          ...versionPayload,
          valid_from: newValidFrom,
        });

        if (insertError) {
          return { success: false as const, error: mapScheduleMutationError(insertError) };
        }
        return { success: true as const };
      }

      const successorId = await findActiveSuccessorSlotId(
        organizationId,
        editDate,
        dayOfWeek,
        locationId
      );

      if (successorId) {
        const closeResult = await closeScheduleSlotByDate(slotId, editDate);
        if (closeResult.success === false) {
          return { success: false as const, error: closeResult.error };
        }

        const { error: updateError } = await supabase
          .from(scheduleTable)
          .update(versionPayload)
          .eq("id", successorId);

        if (updateError) {
          return { success: false as const, error: mapScheduleMutationError(updateError) };
        }
        return { success: true as const };
      }

      const closeResult = await closeScheduleSlotByDate(slotId, editDate);
      if (closeResult.success === false) {
        return { success: false as const, error: closeResult.error };
      }

      const { error: insertError } = await supabase.from(scheduleTable).insert({
        organization_id: organizationId,
        ...versionPayload,
        valid_from: newValidFrom,
      });

      if (insertError) {
        const { error: rollbackError } = await supabase
          .from(scheduleTable)
          .update({ valid_to: null })
          .eq("id", slotId);

        if (rollbackError) {
          return { success: false as const, error: mapScheduleMutationError(insertError) };
        }

        return { success: false as const, error: mapScheduleMutationError(insertError) };
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

export function useUpdateGroupScheduleValidity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      slotIds,
      validTo,
    }: {
      slotIds: string[];
      validTo: string | null;
    }) => {
      if (slotIds.length === 0) {
        return { success: false as const, error: "schedule.error.slotNotFound" };
      }

      const { error } = await supabase
        .from(scheduleTable)
        .update({ valid_to: validTo })
        .in("id", slotIds);

      if (error) {
        return { success: false as const, error: mapScheduleMutationError(error) };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

/** Cancel weekly occurrences via atomic server RPC. */
async function cancelGroupLessonOccurrencesRpc(
  slotId: string,
  cancelDates: string[]
): Promise<
  | { success: true; cancelledCount: number; alreadyApplied?: boolean }
  | { success: false; error: string }
> {
  const { data, error } = await supabase.rpc("cancel_group_lesson_occurrences", {
    p_slot_id: slotId,
    p_cancel_dates: cancelDates,
  });

  if (error) return { success: false as const, error: error.message };

  const result = data as {
    success?: boolean;
    error?: string;
    cancelled_count?: number;
    already_applied?: boolean;
  } | null;

  if (!result?.success) {
    return {
      success: false as const,
      error: result?.error ?? "schedule.error.cancelOneFailed",
    };
  }

  return {
    success: true as const,
    cancelledCount: result.cancelled_count ?? cancelDates.length,
    alreadyApplied: result.already_applied ?? false,
  };
}

export function useCancelGroupLessonOccurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ slotId, cancelDate }: { slotId: string; cancelDate: string }) => {
      const result = await cancelGroupLessonOccurrencesRpc(slotId, [cancelDate]);
      if (result.success === false) return { success: false as const, error: result.error };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

export function useCancelGroupLessonOccurrences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ slotId, cancelDates }: { slotId: string; cancelDates: string[] }) => {
      const result = await cancelGroupLessonOccurrencesRpc(slotId, cancelDates);
      if (result.success === false) {
        return { success: false as const, error: result.error };
      }
      return {
        success: true as const,
        cancelledCount: result.cancelledCount,
        alreadyApplied: result.alreadyApplied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

export function useTeacherGroupVacation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      teacherMemberId,
      startDate,
      endDate,
    }: {
      teacherMemberId: string;
      startDate: string;
      endDate: string;
    }) => {
      const { data, error } = await supabase.rpc("cancel_teacher_group_vacation", {
        p_teacher_member_id: teacherMemberId,
        p_start_date: startDate,
        p_end_date: endDate,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        cancelled_count?: number;
        series_count?: number;
        already_applied?: boolean;
      } | null;

      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "schedule.error.vacationFailed",
        };
      }

      return {
        success: true as const,
        cancelledCount: result.cancelled_count ?? 0,
        seriesCount: result.series_count ?? 0,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

export function useMoveGroupLessonOccurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      slotId,
      sourceDate,
      targetDate,
      targetTimeStart,
      targetTimeEnd,
    }: {
      slotId: string;
      sourceDate: string;
      targetDate: string;
      targetTimeStart: string;
      targetTimeEnd: string;
    }) => {
      const { data, error } = await supabase.rpc("move_group_lesson_occurrence", {
        p_slot_id: slotId,
        p_source_date: sourceDate,
        p_target_date: targetDate,
        p_target_time_start: normalizeTime(targetTimeStart),
        p_target_time_end: normalizeTime(targetTimeEnd),
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; new_slot_id?: string } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "schedule.error.moveFailed",
        };
      }

      return { success: true as const, newSlotId: result.new_slot_id ?? null };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

export function useDeleteScheduleSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: string | { id: string; editDate?: string }) => {
      const id = typeof input === "string" ? input : input.id;
      const closingDate =
        typeof input === "string" ? toISODateLocal(new Date()) : (input.editDate ?? toISODateLocal(new Date()));

      const result = await closeScheduleSlotByDate(id, closingDate);
      if (result.success === false) return { success: false as const, error: result.error };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

/** @deprecated Use useEditGroupSchedule with valid_from/valid_to versioning instead. */
export function useReplaceGroupSchedule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({
      groupName,
      disciplineId,
      locationId,
      teacherMemberId,
      slots,
      removedIds,
    }: {
      groupName: string;
      disciplineId: string;
      locationId: string | null;
      teacherMemberId: string | null;
      slots: GroupScheduleSlotInput[];
      removedIds: string[];
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const trimmedGroup = groupName.trim();
      const editDate = toISODateLocal(new Date());

      for (const id of removedIds) {
        const { error } = await supabase
          .from(scheduleTable)
          .update({ valid_to: editDate })
          .eq("id", id);
        if (error) return { success: false as const, error: error.message };
      }

      for (const slot of slots) {
        const payload = {
          day_of_week: slot.dayOfWeek,
          time: normalizeTime(slot.time),
          time_end: normalizeTime(slot.timeEnd),
          group_name: trimmedGroup,
          discipline_id: disciplineId,
          location_id: locationId,
          teacher_member_id: teacherMemberId,
        };

        if (slot.id != null) {
          const { error: closeError } = await supabase
            .from(scheduleTable)
            .update({ valid_to: editDate })
            .eq("id", slot.id);
          if (closeError) {
            return { success: false as const, error: closeError.message };
          }

          const { error } = await supabase.from(scheduleTable).insert({
            organization_id: organizationId,
            ...payload,
            valid_from: addDays(editDate, 1),
          });
          if (error) {
            if (error.code === "23505") {
              return { success: false as const, error: "schedule.error.duplicateSlot" };
            }
            return { success: false as const, error: error.message };
          }
        } else {
          const { error } = await supabase.from(scheduleTable).insert({
            organization_id: organizationId,
            ...payload,
            valid_from: editDate,
          });
          if (error) {
            if (error.code === "23505") {
              return { success: false as const, error: "schedule.error.duplicateSlot" };
            }
            return { success: false as const, error: error.message };
          }
        }
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}

export function useDeleteGroupSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupName,
      disciplineId,
      locationId,
      editDate = toISODateLocal(new Date()),
    }: {
      groupName: string;
      disciplineId: string;
      locationId: string | null;
      editDate?: string;
    }) => {
      const trimmed = groupName.trim();
      const closingValidTo = addDays(editDate, -1);

      let selectQuery = supabase
        .from(scheduleTable)
        .select("id, valid_from")
        .eq("discipline_id", disciplineId)
        .is("valid_to", null);

      if (locationId) {
        selectQuery = selectQuery.eq("location_id", locationId);
      } else {
        selectQuery = selectQuery.is("location_id", null);
      }

      if (trimmed) {
        selectQuery = selectQuery.eq("group_name", trimmed);
      } else {
        selectQuery = selectQuery.or('group_name.is.null,group_name.eq.""');
      }

      const { data: slots, error: fetchError } = await selectQuery;
      if (fetchError) return { success: false as const, error: fetchError.message };
      if (!slots?.length) return { success: true as const };

      for (const slot of slots) {
        const validFrom = String(slot.valid_from ?? "2000-01-01").slice(0, 10);
        if (closingValidTo < validFrom) {
          const { error } = await supabase.from(scheduleTable).delete().eq("id", slot.id);
          if (error) return { success: false as const, error: error.message };
        } else {
          const { error } = await supabase
            .from(scheduleTable)
            .update({ valid_to: closingValidTo })
            .eq("id", slot.id);
          if (error) return { success: false as const, error: error.message };
        }
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}
