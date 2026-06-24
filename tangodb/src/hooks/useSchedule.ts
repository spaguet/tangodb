import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  addDays,
  expandSlotsToWeek,
  nextOccurrenceOnOrAfter,
  normalizeTime,
  toISODateLocal,
} from "../lib/scheduleWeek";
import type { DisplayLesson, GroupDisplayLesson, PersonalDisplayLesson, ScheduleSlot } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { usePersonalLessons, personalLessonsQueryKey } from "./usePersonalLessons";

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
});

const scheduleTable = "schedule_slots" as const;

export interface ScheduleDayInput {
  dayOfWeek: number;
  time: string;
  timeEnd: string;
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

  const personalQuery = usePersonalLessons({
    dateRange: { start: weekStartISO, end: weekEndISO },
    enabled: queryEnabled,
  });

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
      clientDisplay: lesson.clientDisplay,
    }));

    return {
      slots,
      groupLessons,
      personalLessons,
      lessons: [...groupLessons, ...personalLessons],
    };
  }, [scheduleQuery.data, personalQuery.data, weekStart, weekEnd]);

  return {
    ...scheduleQuery,
    data,
    isLoading: scheduleQuery.isLoading || personalQuery.isLoading,
    isError: scheduleQuery.isError || personalQuery.isError,
    error: scheduleQuery.error ?? personalQuery.error,
  };
}

function invalidateScheduleQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey, refetchType: "active" });
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
    }: {
      groupName: string;
      disciplineId: string;
      locationId: string;
      teacherMemberId: string;
      days: ScheduleDayInput[];
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "Организация не выбрана" };
      }

      const trimmedGroup = groupName.trim();
      if (!trimmedGroup) {
        return { success: false as const, error: "Укажите название группы" };
      }
      if (!locationId) {
        return { success: false as const, error: "Выберите локацию" };
      }
      if (!teacherMemberId) {
        return { success: false as const, error: "Выберите преподавателя" };
      }
      if (days.length === 0) {
        return { success: false as const, error: "Добавьте хотя бы один день" };
      }

      const today = toISODateLocal(new Date());
      const rows = days.map((day) => ({
        organization_id: organizationId,
        day_of_week: day.dayOfWeek,
        time: normalizeTime(day.time),
        time_end: normalizeTime(day.timeEnd),
        discipline_id: disciplineId,
        group_name: trimmedGroup,
        location_id: locationId,
        teacher_member_id: teacherMemberId,
        valid_from: nextOccurrenceOnOrAfter(today, day.dayOfWeek),
      }));

      const { error } = await supabase.from(scheduleTable).insert(rows);
      if (error) {
        if (error.code === "23505") {
          return { success: false as const, error: "Такой день и время уже есть в расписании" };
        }
        if (error.message.includes("schedule_slot_overlap")) {
          return { success: false as const, error: "Пересечение с другим групповым занятием" };
        }
        return { success: false as const, error: error.message };
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
        return { success: false as const, error: "Организация не выбрана" };
      }

      const { error: closeError } = await supabase
        .from(scheduleTable)
        .update({ valid_to: editDate })
        .eq("id", slotId);

      if (closeError) {
        return { success: false as const, error: closeError.message };
      }

      const newValidFrom = addDays(editDate, 1);
      const { error: insertError } = await supabase.from(scheduleTable).insert({
        organization_id: organizationId,
        day_of_week: dayOfWeek,
        time: normalizeTime(time),
        time_end: normalizeTime(timeEnd),
        group_name: groupName.trim(),
        discipline_id: disciplineId,
        location_id: locationId,
        teacher_member_id: teacherMemberId,
        valid_from: newValidFrom,
      });

      if (insertError) {
        const { error: rollbackError } = await supabase
          .from(scheduleTable)
          .update({ valid_to: null })
          .eq("id", slotId);

        if (rollbackError) {
          return {
            success: false as const,
            error: `Не удалось сохранить изменения; слот мог остаться закрытым: ${rollbackError.message}`,
          };
        }

        if (insertError.code === "23505") {
          return { success: false as const, error: "Такой день и время уже есть в расписании" };
        }
        if (insertError.message.includes("schedule_slot_overlap")) {
          return { success: false as const, error: "Пересечение с другим групповым занятием" };
        }
        return { success: false as const, error: insertError.message };
      }

      return { success: true as const };
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
      const editDate =
        typeof input === "string" ? toISODateLocal(new Date()) : (input.editDate ?? toISODateLocal(new Date()));

      const { error } = await supabase
        .from(scheduleTable)
        .update({ valid_to: editDate })
        .eq("id", id);
      if (error) return { success: false as const, error: error.message };
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
        return { success: false as const, error: "Организация не выбрана" };
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
              return { success: false as const, error: "Такой день и время уже есть в расписании" };
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
              return { success: false as const, error: "Такой день и время уже есть в расписании" };
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
      let query = supabase
        .from(scheduleTable)
        .update({ valid_to: editDate })
        .eq("discipline_id", disciplineId)
        .is("valid_to", null);

      if (locationId) {
        query = query.eq("location_id", locationId);
      } else {
        query = query.is("location_id", null);
      }

      if (trimmed) {
        query = query.eq("group_name", trimmed);
      } else {
        query = query.or('group_name.is.null,group_name.eq.""');
      }

      const { error } = await query;
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateScheduleQueries(queryClient);
    },
  });
}
