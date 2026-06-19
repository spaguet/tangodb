import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { ScheduleSlot } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const scheduleQueryKey = ["schedule"] as const;

const mapScheduleSlot = (row: Record<string, unknown>): ScheduleSlot => ({
  id: row.id != null ? String(row.id) : undefined,
  dayOfWeek: row.day_of_week as number,
  time: row.time as string,
  timeEnd: (row.time_end as string) || "21:00",
  disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
  groupName: ((row.group_name as string) || "").trim() || undefined,
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

export function useSchedule() {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(scheduleQueryKey),
    enabled,
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

export function useAddGroupSchedule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({
      groupName,
      disciplineId,
      days,
    }: {
      groupName: string;
      disciplineId: string;
      days: ScheduleDayInput[];
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "Организация не выбрана" };
      }

      const trimmedGroup = groupName.trim();
      if (!trimmedGroup) {
        return { success: false as const, error: "Укажите название группы" };
      }
      if (days.length === 0) {
        return { success: false as const, error: "Добавьте хотя бы один день" };
      }

      const rows = days.map((day) => ({
        organization_id: organizationId,
        day_of_week: day.dayOfWeek,
        time: day.time,
        time_end: day.timeEnd,
        discipline_id: disciplineId,
        group_name: trimmedGroup,
      }));

      const { error } = await supabase.from(scheduleTable).insert(rows);
      if (error) {
        if (error.code === "23505") {
          return { success: false as const, error: "Такой день и время уже есть в расписании" };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    },
  });
}

export function useDeleteScheduleSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(scheduleTable).delete().eq("id", id);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    },
  });
}

export function useReplaceGroupSchedule() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({
      groupName,
      disciplineId,
      slots,
      removedIds,
    }: {
      groupName: string;
      disciplineId: string;
      slots: GroupScheduleSlotInput[];
      removedIds: string[];
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "Организация не выбрана" };
      }

      const trimmedGroup = groupName.trim();

      for (const id of removedIds) {
        const { error } = await supabase.from(scheduleTable).delete().eq("id", id);
        if (error) return { success: false as const, error: error.message };
      }

      for (const slot of slots) {
        const payload = {
          day_of_week: slot.dayOfWeek,
          time: slot.time,
          time_end: slot.timeEnd,
          group_name: trimmedGroup,
          discipline_id: disciplineId,
        };

        if (slot.id != null) {
          const { error } = await supabase.from(scheduleTable).update(payload).eq("id", slot.id);
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
      if (result.success) void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    },
  });
}

export function useDeleteGroupSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      groupName,
      disciplineId,
    }: {
      groupName: string;
      disciplineId: string;
    }) => {
      const trimmed = groupName.trim();
      let query = supabase.from(scheduleTable).delete().eq("discipline_id", disciplineId);

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
      if (result.success) void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    },
  });
}
