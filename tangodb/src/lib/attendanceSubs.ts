import {
  canApplyFreeze,
  DEFAULT_FREEZE_POLICY,
  type FreezePolicy,
} from "./freezePolicy";
import { subscriptionMatchesScheduleGroup } from "./scheduleGroups";
import { resolveSubscriptionMemberNamesAtDate } from "./subscriptionMembers";
import {
  getSubscriptionDaysLeft,
  isMonthlyUnlimitedSubscription,
  subscriptionIsActiveForDate,
} from "./utils";
import type {
  AttendanceRecord,
  Client,
  SubForDate,
  Subscription,
  SubscriptionGroupLink,
  SubscriptionMemberChange,
} from "../types";

function subscriptionHasAttendanceOnDate(
  subId: string,
  dateStr: string,
  attendance: AttendanceRecord[],
  scheduleGroupId?: string | null
): boolean {
  return attendance.some(
    (record) =>
      record.date === dateStr &&
      record.subscriptionId === subId &&
      (!scheduleGroupId || record.scheduleGroupId === scheduleGroupId)
  );
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
      const hasAttendanceOnDate = subscriptionHasAttendanceOnDate(
        s.id,
        dateStr,
        attendance,
        scheduleGroupId
      );
      if (!subscriptionIsActiveForDate(s, dateStr) && !hasAttendanceOnDate) return false;
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
