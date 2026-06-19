import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { reportClientError } from "../lib/reportClientError";
import { formatClientName, jsDayToIsoDow } from "../lib/utils";
import {
  canApplyFreeze,
  DEFAULT_FREEZE_POLICY,
  type FreezePolicy,
  wouldExceedFreezeLimit,
} from "../lib/freezePolicy";
import type { AttendanceRecord, Client, ScheduleSlot, SubForDate, Subscription } from "../types";
import { useClientDirectory } from "./useClients";
import { useSchedule } from "./useSchedule";
import { subscriptionsQueryKey, useSubscriptions } from "./useSubscriptions";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { useSettings } from "../settings/SettingsProvider";

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
): { date: string; time: string; timeEnd: string; groupName?: string }[] {
  if (!schedule.length || !yearMonth) return [];

  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  if (!year || !month) return [];

  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: { date: string; time: string; timeEnd: string; groupName?: string }[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dow = jsDayToIsoDow(date.getDay());

    schedule.forEach((slot) => {
      if (slot.dayOfWeek === dow) {
        const dd = String(day).padStart(2, "0");
        const mm = String(month).padStart(2, "0");
        dates.push({
          date: `${year}-${mm}-${dd}`,
          time: slot.time,
          timeEnd: slot.timeEnd || "21:00",
          groupName: slot.groupName,
        });
      }
    });
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export function computeSubsForDate(
  dateStr: string,
  subscriptions: Subscription[],
  clients: Client[],
  attendance: AttendanceRecord[],
  options?: { category?: "group" | "private"; subscriptionIds?: string[] },
  freezePolicy: FreezePolicy = DEFAULT_FREEZE_POLICY
): SubForDate[] {
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const idFilter = options?.subscriptionIds ? new Set(options.subscriptionIds) : null;

  return subscriptions
    .filter((s) => {
      if (s.status !== "active" || s.activationDate > dateStr || s.lessonsLeft <= 0) return false;
      if (options?.category && s.category !== options.category) return false;
      if (idFilter && !idFilter.has(s.id)) return false;
      return true;
    })
    .map((s) => {
      const c1 = clientMap[s.clientId1];
      const c2 = s.clientId2 ? clientMap[s.clientId2] : null;
      const c3 = s.clientId3 ? clientMap[s.clientId3] : null;
      const existing = attendance.find((a) => a.date === dateStr && a.subscriptionId === s.id);

      return {
        subId: s.id,
        type: s.type,
        pairMonth: s.pairMonth,
        client1: c1 ? formatClientName(c1.lastName, c1.firstName) : s.clientId1,
        client2: c2 ? formatClientName(c2.lastName, c2.firstName) : "",
        client3: c3 ? formatClientName(c3.lastName, c3.firstName) : "",
        lessonsLeft: s.lessonsLeft,
        lessonsTotal: s.lessonsTotal,
        freezeUsed: s.freezeUsed,
        activationDate: s.activationDate,
        currentStatus: (existing?.attendanceStatus ?? null) as SubForDate["currentStatus"],
        canFreeze: canApplyFreeze(s.lessonsTotal, s.freezeUsed, freezePolicy),
        priceId: s.priceId,
        category: s.category,
      };
    });
}

export function useAttendanceRecords(yearMonth?: string) {
  const { enabled, withOrgId } = useOrgQueryScope();
  const baseKey = yearMonth ? [...attendanceQueryKey, yearMonth] : attendanceQueryKey;

  return useQuery({
    queryKey: withOrgId(baseKey),
    enabled,
    queryFn: async () => {
      let query = supabase
        .from("attendance")
        .select("*")
        .order("date", { ascending: false });

      if (yearMonth) {
        const [y, m] = yearMonth.split("-").map(Number);
        const start = `${y}-${String(m).padStart(2, "0")}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        query = query.gte("date", start).lte("date", end);
      }

      const { data, error } = await query;
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
    isError: scheduleQuery.isError,
    error: scheduleQuery.error,
  };
}

export function useSubsForDate(
  dateStr?: string,
  options?: { category?: "group" | "private"; subscriptionIds?: string[] },
  yearMonth?: string
) {
  const subscriptionsQuery = useSubscriptions();
  const clientsQuery = useClientDirectory();
  const attendanceQuery = useAttendanceRecords(yearMonth);
  const { freezePolicy } = useSettings();

  const optionsKey = `${options?.category ?? ""}|${(options?.subscriptionIds ?? []).join(",")}`;
  const stableOptions = useMemo(
    () =>
      options
        ? { category: options.category, subscriptionIds: options.subscriptionIds }
        : undefined,
    [optionsKey]
  );

  const getSubsForDate = useCallback(
    (date: string, opts?: { category?: "group" | "private"; subscriptionIds?: string[] }) =>
      computeSubsForDate(
        date,
        subscriptionsQuery.data ?? [],
        clientsQuery.data ?? [],
        attendanceQuery.data ?? [],
        opts ?? stableOptions,
        freezePolicy
      ),
    [subscriptionsQuery.data, clientsQuery.data, attendanceQuery.data, stableOptions, freezePolicy]
  );

  const subs = useMemo(
    () =>
      dateStr
        ? computeSubsForDate(
            dateStr,
            subscriptionsQuery.data ?? [],
            clientsQuery.data ?? [],
            attendanceQuery.data ?? [],
            stableOptions,
            freezePolicy
          )
        : undefined,
    [dateStr, subscriptionsQuery.data, clientsQuery.data, attendanceQuery.data, stableOptions, freezePolicy]
  );

  return {
    subs,
    getSubsForDate,
    isLoading: subscriptionsQuery.isLoading || clientsQuery.isLoading || attendanceQuery.isLoading,
    isError: subscriptionsQuery.isError || clientsQuery.isError || attendanceQuery.isError,
    error: subscriptionsQuery.error ?? clientsQuery.error ?? attendanceQuery.error,
  };
}

/** Mirrors mark_attendance RPC lesson/freeze deltas for optimistic cache updates */
function computeAttendanceDeltas(
  oldStatus: "present" | "absent" | "freeze" | null,
  newStatus: "present" | "absent" | "freeze"
): { lessonDelta: number; freezeDelta: number } {
  let lessonDelta = 0;
  let freezeDelta = 0;

  if (oldStatus === "present" || oldStatus === "absent") lessonDelta += 1;
  if (oldStatus === "freeze") freezeDelta -= 1;

  if (newStatus === "present" || newStatus === "absent") lessonDelta -= 1;
  if (newStatus === "freeze") freezeDelta += 1;

  if (
    (oldStatus === "present" || oldStatus === "absent") &&
    (newStatus === "present" || newStatus === "absent")
  ) {
    lessonDelta = 0;
  }

  return { lessonDelta, freezeDelta };
}

export function useMarkAttendance() {
  const queryClient = useQueryClient();
  const { withOrgId } = useOrgQueryScope();
  const { freezePolicy } = useSettings();
  const scopedAttendanceKey = withOrgId(attendanceQueryKey);
  const scopedSubscriptionsKey = withOrgId(subscriptionsQueryKey);

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
    onMutate: async ({ dateStr, subId, status }) => {
      await queryClient.cancelQueries({ queryKey: scopedAttendanceKey });
      await queryClient.cancelQueries({ queryKey: scopedSubscriptionsKey });

      const previousAttendanceEntries = queryClient.getQueriesData<AttendanceRecord[]>({
        queryKey: scopedAttendanceKey,
      });
      const previousSubscriptions = queryClient.getQueryData<Subscription[]>(scopedSubscriptionsKey);

      const sub = previousSubscriptions?.find((s) => s.id === subId);
      if (!sub) return { previousAttendanceEntries, previousSubscriptions };

      const previousAttendance = previousAttendanceEntries[0]?.[1];
      const existing = previousAttendance?.find(
        (a) => a.date === dateStr && a.subscriptionId === subId
      );
      const oldStatus = existing?.attendanceStatus ?? null;

      if (oldStatus === status) {
        return { previousAttendanceEntries, previousSubscriptions };
      }

      const { lessonDelta, freezeDelta } = computeAttendanceDeltas(oldStatus, status);

      if (status === "freeze" && !canApplyFreeze(sub.lessonsTotal, sub.freezeUsed, freezePolicy)) {
        return { previousAttendanceEntries, previousSubscriptions };
      }
      if (status === "freeze" && wouldExceedFreezeLimit(sub.freezeUsed, freezeDelta, freezePolicy)) {
        return { previousAttendanceEntries, previousSubscriptions };
      }
      if (sub.lessonsLeft + lessonDelta < 0) {
        return { previousAttendanceEntries, previousSubscriptions };
      }

      queryClient.setQueriesData<AttendanceRecord[]>(
        { queryKey: scopedAttendanceKey },
        (old) => {
          const base = old ?? [];
          const attIdx = base.findIndex(
            (a) => a.date === dateStr && a.subscriptionId === subId
          );
          if (attIdx >= 0) {
            const updated = [...base];
            updated[attIdx] = { ...updated[attIdx], attendanceStatus: status };
            return updated;
          }
          return [
            ...base,
            {
              date: dateStr,
              subscriptionId: subId,
              clientDisplay: "",
              attendanceStatus: status,
            },
          ];
        }
      );

      const newLessonsLeft = sub.lessonsLeft + lessonDelta;
      const newFreezeUsed = sub.freezeUsed + freezeDelta;
      queryClient.setQueryData<Subscription[]>(
        scopedSubscriptionsKey,
        (old) =>
          (old ?? []).map((s) =>
            s.id === subId
              ? {
                  ...s,
                  lessonsLeft: newLessonsLeft,
                  freezeUsed: newFreezeUsed,
                  status: newLessonsLeft === 0 ? "finished" : s.status,
                }
              : s
          )
      );

      return { previousAttendanceEntries, previousSubscriptions };
    },
    onError: (error, _vars, context) => {
      reportClientError(error, { area: "mutation", action: "useMarkAttendance" });
      if (context?.previousAttendanceEntries) {
        for (const [key, data] of context.previousAttendanceEntries) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousSubscriptions) {
        queryClient.setQueryData(scopedSubscriptionsKey, context.previousSubscriptions);
      }
    },
    onSettled: (result) => {
      if (result?.success) {
        void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
        void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
      }
    },
  });
}
