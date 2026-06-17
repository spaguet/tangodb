import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { ScheduleSlot } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const scheduleQueryKey = ["schedule"] as const;

const mapScheduleSlot = (row: Record<string, unknown>): ScheduleSlot => ({
  id: row.id as number,
  dayOfWeek: row.day_of_week as number,
  time: row.time as string,
  timeEnd: (row.time_end as string) || "21:00",
  disciplineId: row.discipline_id != null ? (row.discipline_id as number) : null,
});

export function useSchedule() {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(scheduleQueryKey),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule")
        .select("*")
        .order("day_of_week")
        .order("time");
      if (error) throw error;
      return (data ?? []).map(mapScheduleSlot);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddScheduleSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      dayOfWeek,
      time,
      timeEnd,
      disciplineId,
    }: {
      dayOfWeek: number;
      time: string;
      timeEnd: string;
      disciplineId: number;
    }) => {
      const { error } = await supabase.from("schedule").insert({
        day_of_week: dayOfWeek,
        time,
        time_end: timeEnd,
        discipline_id: disciplineId,
      });
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
    mutationFn: async (id: number) => {
      const { error } = await supabase.from("schedule").delete().eq("id", id);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    },
  });
}

export interface DisciplineScheduleSlotInput {
  id?: number;
  dayOfWeek: number;
  time: string;
  timeEnd: string;
}

export function useReplaceDisciplineSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      disciplineId,
      slots,
      removedIds,
    }: {
      disciplineId: number;
      slots: DisciplineScheduleSlotInput[];
      removedIds: number[];
    }) => {
      for (const id of removedIds) {
        const { error } = await supabase.from("schedule").delete().eq("id", id);
        if (error) return { success: false as const, error: error.message };
      }

      for (const slot of slots) {
        if (slot.id != null) {
          const { error } = await supabase
            .from("schedule")
            .update({
              day_of_week: slot.dayOfWeek,
              time: slot.time,
              time_end: slot.timeEnd,
            })
            .eq("id", slot.id);
          if (error) {
            if (error.code === "23505") {
              return { success: false as const, error: "Такой день и время уже есть в расписании" };
            }
            return { success: false as const, error: error.message };
          }
        } else {
          const { error } = await supabase.from("schedule").insert({
            day_of_week: slot.dayOfWeek,
            time: slot.time,
            time_end: slot.timeEnd,
            discipline_id: disciplineId,
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

export function useDeleteDisciplineSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (disciplineId: number) => {
      const { error } = await supabase.from("schedule").delete().eq("discipline_id", disciplineId);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: scheduleQueryKey });
    },
  });
}
