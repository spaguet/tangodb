import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { AttendanceRecord, Client, ScheduleSlot, SubForDate, Subscription } from "../types";
import { useClients } from "./useClients";
import { useSchedule } from "./useSchedule";
import { subscriptionsQueryKey, useSubscriptions } from "./useSubscriptions";

export const attendanceQueryKey = ["attendance"] as const;

const mapAttendanceRecord = (row: Record<string, unknown>): AttendanceRecord => ({
  id: row.id as number | undefined,
  date: String(row.date ?? "").slice(0, 10),
  subscriptionId: row.subscription_id as string,
  clientDisplay: row.client_display as string,
  attendanceStatus: row.attendance_status as "present" | "absent" | "freeze",
});

export function computeScheduleDatesForMonth(
  schedule: ScheduleSlot[],
  yearMonth: string
): { date: string; time: string }[] {
  if (!schedule.length || !yearMonth) return [];

  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  if (!year || !month) return [];

  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: { date: string; time: string }[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const jsDay = date.getDay();
    const dow = jsDay === 0 ? 7 : jsDay;

    schedule.forEach((slot) => {
      if (slot.dayOfWeek === dow) {
        const dd = String(day).padStart(2, "0");
        const mm = String(month).padStart(2, "0");
        dates.push({ date: `${year}-${mm}-${dd}`, time: slot.time });
      }
    });
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export function computeSubsForDate(
  dateStr: string,
  subscriptions: Subscription[],
  clients: Client[],
  attendance: AttendanceRecord[]
): SubForDate[] {
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));

  return subscriptions
    .filter((s) => s.status === "active" && s.activationDate <= dateStr && s.lessonsLeft > 0)
    .map((s) => {
      const c1 = clientMap[s.clientId1];
      const c2 = s.clientId2 ? clientMap[s.clientId2] : null;
      const existing = attendance.find((a) => a.date === dateStr && a.subscriptionId === s.id);

      return {
        subId: s.id,
        type: s.type,
        client1: c1 ? `${c1.lastName} ${c1.firstName}` : s.clientId1,
        client2: c2 ? `${c2.lastName} ${c2.firstName}` : "",
        lessonsLeft: s.lessonsLeft,
        lessonsTotal: s.lessonsTotal,
        freezeUsed: s.freezeUsed,
        activationDate: s.activationDate,
        currentStatus: (existing?.attendanceStatus ?? null) as SubForDate["currentStatus"],
        canFreeze: s.lessonsTotal === 8 && s.freezeUsed === 0,
      };
    });
}

export function useAttendanceRecords() {
  return useQuery({
    queryKey: attendanceQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("attendance")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapAttendanceRecord);
    },
    staleTime: 30 * 1000,
  });
}

export function useScheduleDates(yearMonth?: string) {
  const scheduleQuery = useSchedule();

  const getScheduleDatesForMonth = useCallback(
    (month: string) => computeScheduleDatesForMonth(scheduleQuery.data ?? [], month),
    [scheduleQuery.data]
  );

  const dates = useMemo(
    () => (yearMonth ? computeScheduleDatesForMonth(scheduleQuery.data ?? [], yearMonth) : undefined),
    [scheduleQuery.data, yearMonth]
  );

  return {
    dates,
    getScheduleDatesForMonth,
    isLoading: scheduleQuery.isLoading,
  };
}

export function useSubsForDate(dateStr?: string) {
  const subscriptionsQuery = useSubscriptions();
  const clientsQuery = useClients();
  const attendanceQuery = useAttendanceRecords();

  const getSubsForDate = useCallback(
    (date: string) =>
      computeSubsForDate(
        date,
        subscriptionsQuery.data ?? [],
        clientsQuery.data ?? [],
        attendanceQuery.data ?? []
      ),
    [subscriptionsQuery.data, clientsQuery.data, attendanceQuery.data]
  );

  const subs = useMemo(
    () =>
      dateStr
        ? computeSubsForDate(
            dateStr,
            subscriptionsQuery.data ?? [],
            clientsQuery.data ?? [],
            attendanceQuery.data ?? []
          )
        : undefined,
    [dateStr, subscriptionsQuery.data, clientsQuery.data, attendanceQuery.data]
  );

  return {
    subs,
    getSubsForDate,
    isLoading: subscriptionsQuery.isLoading || clientsQuery.isLoading || attendanceQuery.isLoading,
  };
}

export function useMarkAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      dateStr,
      subId,
      status,
    }: {
      dateStr: string;
      subId: string;
      status: "present" | "absent" | "freeze";
    }) => {
      const { data, error } = await supabase.rpc("mark_attendance", {
        p_date: dateStr,
        p_sub_id: subId,
        p_new_status: status,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; newLessonsLeft?: number } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "Не удалось сохранить изменения" };
      }

      return {
        success: true as const,
        newLessonsLeft: result.newLessonsLeft,
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
        void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
      }
    },
  });
}
