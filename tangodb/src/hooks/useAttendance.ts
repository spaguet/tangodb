import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { reportClientError } from "../lib/reportClientError";
import { formatClientName, getSubscriptionDaysLeft, isMonthlyUnlimitedSubscription, jsDayToIsoDow, subscriptionIsActiveForDate } from "../lib/utils";
import {
  canApplyFreeze,
  DEFAULT_FREEZE_POLICY,
  type FreezePolicy,
  wouldExceedFreezeLimit,
} from "../lib/freezePolicy";
import { subscriptionMatchesScheduleGroup } from "../lib/scheduleGroups";
import type {
  AttendanceRecord,
  Client,
  PersonalLesson,
  ScheduleSlot,
  SubForDate,
  Subscription,
  SubscriptionGroupLink,
  SubscriptionMemberChange,
} from "../types";
import { useClientDirectory } from "./useClients";
import { useSchedule } from "./useSchedule";
import { subscriptionsQueryKey, useSubscriptions } from "./useSubscriptions";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { useSettings } from "../settings/SettingsProvider";
import {
  buildMemberChangesBySubId,
  resolveSubscriptionMemberNamesAtDate,
} from "../lib/subscriptionMembers";
import { useAllSubscriptionMemberChanges } from "./useSubscriptionMemberChanges";

export const attendanceQueryKey = ["attendance"] as const;

const mapAttendanceRecord = (row: Record<string, unknown>): AttendanceRecord => ({
  id: row.id != null ? String(row.id) : undefined,
  date: String(row.date ?? "").slice(0, 10),
  subscriptionId: row.subscription_id as string,
  scheduleGroupId: row.schedule_group_id as string,
  clientDisplay: row.client_display as string,
  attendanceStatus: row.attendance_status as "present" | "absent" | "freeze" | "excused",
});

export type ScheduleDateEntry = {
  slotId?: string;
  date: string;
  time: string;
  timeEnd: string;
  groupName?: string;
  scheduleGroupId?: string | null;
  disciplineId?: string | null;
  locationId?: string | null;
  teacherMemberId?: string | null;
};

export function filterScheduleByLocation(
  schedule: ScheduleSlot[],
  locationId?: string | null
): ScheduleSlot[] {
  if (locationId == null) return schedule;
  return schedule.filter((slot) => (slot.locationId ?? null) === locationId);
}

export function computeScheduleDatesForMonth(
  schedule: ScheduleSlot[],
  yearMonth: string,
  locationId?: string | null
): ScheduleDateEntry[] {
  const scoped = filterScheduleByLocation(schedule, locationId);
  if (!scoped.length || !yearMonth) return [];

  const [yearStr, monthStr] = yearMonth.split("-");
  const year = parseInt(yearStr);
  const month = parseInt(monthStr);
  if (!year || !month) return [];

  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: ScheduleDateEntry[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dow = jsDayToIsoDow(date.getDay());

    scoped.forEach((slot) => {
      if (slot.dayOfWeek !== dow) return;

      const dd = String(day).padStart(2, "0");
      const mm = String(month).padStart(2, "0");
      const dateStr = `${year}-${mm}-${dd}`;
      const validFrom = slot.validFrom ?? "2000-01-01";

      if (dateStr < validFrom) return;
      if (slot.validTo != null && dateStr > slot.validTo) return;

      dates.push({
        slotId: slot.id,
        date: dateStr,
        time: slot.time,
        timeEnd: slot.timeEnd || "21:00",
        groupName: slot.groupName,
        scheduleGroupId: slot.scheduleGroupId ?? null,
        disciplineId: slot.disciplineId ?? null,
        locationId: slot.locationId ?? null,
        teacherMemberId: slot.teacherMemberId ?? null,
      });
    });
  }

  return dates.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

export function computeSubsForDate(
  dateStr: string,
  subscriptions: Subscription[],
  clients: Client[],
  attendance: AttendanceRecord[],
  options?: {
    category?: "group" | "private";
    subscriptionIds?: string[];
    disciplineId?: string | null;
    scheduleGroupId?: string | null;
    groupsBySubId?: Record<string, SubscriptionGroupLink[]>;
    memberChangesBySubId?: Record<string, SubscriptionMemberChange[]>;
  },
  freezePolicy: FreezePolicy = DEFAULT_FREEZE_POLICY
): SubForDate[] {
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  const idFilter = options?.subscriptionIds ? new Set(options.subscriptionIds) : null;
  const disciplineFilter = options?.disciplineId ?? null;
  const scheduleGroupId = options?.scheduleGroupId ?? null;
  const memberChangesBySubId = options?.memberChangesBySubId ?? {};

  return subscriptions
    .filter((s) => {
      if (!subscriptionIsActiveForDate(s, dateStr)) return false;
      if (options?.category && s.category !== options.category) return false;
      if (idFilter && !idFilter.has(s.id)) return false;
      if (disciplineFilter != null && s.disciplineId !== disciplineFilter) return false;
      if (
        scheduleGroupId &&
        !subscriptionMatchesScheduleGroup(s.id, scheduleGroupId, options?.groupsBySubId ?? {})
      ) {
        return false;
      }
      return true;
    })
    .map((s) => {
      const subChanges = memberChangesBySubId[s.id] ?? [];
      const { client1, client2, client3 } = resolveSubscriptionMemberNamesAtDate(
        s,
        subChanges,
        clientMap,
        dateStr
      );
      const existing = attendance.find(
        (a) =>
          a.date === dateStr &&
          a.subscriptionId === s.id &&
          (!scheduleGroupId || a.scheduleGroupId === scheduleGroupId)
      );
      const isMonthly = isMonthlyUnlimitedSubscription(s);

      return {
        subId: s.id,
        type: s.type,
        pairMonth: s.pairMonth,
        client1,
        client2,
        client3,
        lessonsLeft: s.lessonsLeft,
        lessonsTotal: s.lessonsTotal,
        freezeUsed: s.freezeUsed,
        activationDate: s.activationDate,
        billingModel: s.billingModel,
        expiresAt: s.expiresAt ?? null,
        daysLeft: isMonthly ? getSubscriptionDaysLeft(s.expiresAt, dateStr) : undefined,
        currentStatus: (existing?.attendanceStatus ?? null) as SubForDate["currentStatus"],
        canFreeze: canApplyFreeze(s.lessonsTotal, s.freezeUsed, freezePolicy, s.billingModel),
        priceId: s.priceId,
        category: s.category,
      };
    });
}

export type SubscriptionAttendanceStats = {
  visits: number;
  absences: number;
};

export function computeSubscriptionAttendanceStats(
  attendance: AttendanceRecord[],
  personalLessons: PersonalLesson[] = []
): Record<string, SubscriptionAttendanceStats> {
  const stats: Record<string, SubscriptionAttendanceStats> = {};

  const bump = (subId: string, field: "visits" | "absences") => {
    if (!stats[subId]) stats[subId] = { visits: 0, absences: 0 };
    stats[subId][field] += 1;
  };

  for (const record of attendance) {
    if (record.attendanceStatus === "present") bump(record.subscriptionId, "visits");
    else if (record.attendanceStatus === "absent") bump(record.subscriptionId, "absences");
  }

  for (const lesson of personalLessons) {
    if (!lesson.subscriptionId || !lesson.attendanceStatus) continue;
    if (lesson.attendanceStatus === "present") bump(lesson.subscriptionId, "visits");
    else if (lesson.attendanceStatus === "absent") bump(lesson.subscriptionId, "absences");
  }

  return stats;
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

export function useScheduleDates(yearMonth?: string, locationId?: string | null) {
  const scheduleQuery = useSchedule();

  const getScheduleDatesForMonth = useCallback(
    (month: string, locId?: string | null) =>
      computeScheduleDatesForMonth(scheduleQuery.data ?? [], month, locId ?? locationId),
    [scheduleQuery.data, locationId]
  );

  const dates = useMemo(
    () =>
      yearMonth
        ? computeScheduleDatesForMonth(scheduleQuery.data ?? [], yearMonth, locationId)
        : undefined,
    [scheduleQuery.data, yearMonth, locationId]
  );

  return {
    dates,
    getScheduleDatesForMonth,
    isLoading: scheduleQuery.isLoading,
    isError: scheduleQuery.isError,
    error: scheduleQuery.error,
  };
}

export type SubsForDateOptions = {
  category?: "group" | "private";
  subscriptionIds?: string[];
  disciplineId?: string | null;
  scheduleGroupId?: string | null;
  groupsBySubId?: Record<string, SubscriptionGroupLink[]>;
  memberChangesBySubId?: Record<string, SubscriptionMemberChange[]>;
};

export function useSubsForDate(
  dateStr?: string,
  options?: SubsForDateOptions,
  yearMonth?: string
) {
  const subscriptionsQuery = useSubscriptions();
  const clientsQuery = useClientDirectory();
  const attendanceQuery = useAttendanceRecords(yearMonth);
  const memberChangesQuery = useAllSubscriptionMemberChanges();
  const { freezePolicy } = useSettings();

  const memberChangesBySubId = useMemo(
    () => buildMemberChangesBySubId(memberChangesQuery.data ?? []),
    [memberChangesQuery.data]
  );

  const optionsKey = `${options?.category ?? ""}|${options?.disciplineId ?? ""}|${options?.scheduleGroupId ?? ""}|${(options?.subscriptionIds ?? []).join(",")}`;
  const stableOptions = useMemo(
    () =>
      options
        ? {
            category: options.category,
            subscriptionIds: options.subscriptionIds,
            disciplineId: options.disciplineId,
            scheduleGroupId: options.scheduleGroupId,
            groupsBySubId: options.groupsBySubId,
            memberChangesBySubId,
          }
        : undefined,
    [optionsKey, options?.groupsBySubId, memberChangesBySubId]
  );

  const getSubsForDate = useCallback(
    (date: string, opts?: SubsForDateOptions) =>
      computeSubsForDate(
        date,
        subscriptionsQuery.data ?? [],
        clientsQuery.data ?? [],
        attendanceQuery.data ?? [],
        {
          ...(opts ?? stableOptions),
          memberChangesBySubId: opts?.memberChangesBySubId ?? memberChangesBySubId,
        },
        freezePolicy
      ),
    [
      subscriptionsQuery.data,
      clientsQuery.data,
      attendanceQuery.data,
      stableOptions,
      freezePolicy,
      memberChangesBySubId,
    ]
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
    [
      dateStr,
      subscriptionsQuery.data,
      clientsQuery.data,
      attendanceQuery.data,
      stableOptions,
      freezePolicy,
    ]
  );

  return {
    subs,
    getSubsForDate,
    isLoading:
      subscriptionsQuery.isLoading ||
      clientsQuery.isLoading ||
      attendanceQuery.isLoading ||
      memberChangesQuery.isLoading,
    isError:
      subscriptionsQuery.isError ||
      clientsQuery.isError ||
      attendanceQuery.isError ||
      memberChangesQuery.isError,
    error:
      subscriptionsQuery.error ??
      clientsQuery.error ??
      attendanceQuery.error ??
      memberChangesQuery.error,
  };
}

/** Mirrors mark_attendance RPC lesson/freeze deltas for optimistic cache updates */
function computeAttendanceDeltas(
  oldStatus: "present" | "absent" | "freeze" | "excused" | null,
  newStatus: "present" | "absent" | "freeze" | "excused"
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
      disciplineId,
      scheduleGroupId,
    }: {
      dateStr: string;
      subId: string;
      status: "present" | "absent" | "freeze" | "excused";
      disciplineId?: string | null;
      scheduleGroupId: string;
    }) => {
      const { data, error } = await supabase.rpc("mark_attendance", {
        p_date: dateStr,
        p_sub_id: subId,
        p_new_status: status,
        p_discipline_id: disciplineId ?? null,
        p_schedule_group_id: scheduleGroupId,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; newLessonsLeft?: number } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "common.saveFailed" };
      }

      return {
        success: true as const,
        newLessonsLeft: result.newLessonsLeft,
      };
    },
    onMutate: async ({ dateStr, subId, status, scheduleGroupId }) => {
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
        (a) =>
          a.date === dateStr &&
          a.subscriptionId === subId &&
          a.scheduleGroupId === scheduleGroupId
      );
      const oldStatus = existing?.attendanceStatus ?? null;

      if (oldStatus === status) {
        return { previousAttendanceEntries, previousSubscriptions };
      }

      const isMonthly = isMonthlyUnlimitedSubscription(sub);
      const { lessonDelta, freezeDelta } = isMonthly
        ? { lessonDelta: 0, freezeDelta: 0 }
        : computeAttendanceDeltas(oldStatus, status);

      if (!isMonthly) {
        if (status === "freeze" && !canApplyFreeze(sub.lessonsTotal, sub.freezeUsed, freezePolicy, sub.billingModel)) {
          return { previousAttendanceEntries, previousSubscriptions };
        }
        if (status === "freeze" && wouldExceedFreezeLimit(sub.freezeUsed, freezeDelta, freezePolicy)) {
          return { previousAttendanceEntries, previousSubscriptions };
        }
        if (sub.lessonsLeft + lessonDelta < 0) {
          return { previousAttendanceEntries, previousSubscriptions };
        }
      }

      queryClient.setQueriesData<AttendanceRecord[]>(
        { queryKey: scopedAttendanceKey },
        (old) => {
          const base = old ?? [];
          const attIdx = base.findIndex(
            (a) =>
              a.date === dateStr &&
              a.subscriptionId === subId &&
              a.scheduleGroupId === scheduleGroupId
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
              scheduleGroupId,
              clientDisplay: "",
              attendanceStatus: status,
            },
          ];
        }
      );

      if (!isMonthly) {
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
      }

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
