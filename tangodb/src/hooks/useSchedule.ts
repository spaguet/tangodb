import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { ScheduleSlot } from "../types";

export const scheduleQueryKey = ["schedule"] as const;

const mapScheduleSlot = (row: Record<string, unknown>): ScheduleSlot => ({
  id: row.id as number,
  dayOfWeek: row.day_of_week as number,
  time: row.time as string,
  timeEnd: (row.time_end as string) || "21:00",
});

export function useSchedule() {
  return useQuery({
    queryKey: scheduleQueryKey,
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
    }: {
      dayOfWeek: number;
      time: string;
      timeEnd: string;
    }) => {
      const { error } = await supabase.from("schedule").insert({
        day_of_week: dayOfWeek,
        time,
        time_end: timeEnd,
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
