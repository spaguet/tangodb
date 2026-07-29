import type { Client, Price, Subscription, SubscriptionGroupLink, SubscriptionMemberChange } from "../types";
import { subscriptionMatchesScheduleGroup } from "./scheduleGroups";
import { clientIsSubscriptionMemberAtDate } from "./subscriptionMembers";
import {
  getSubscriptionDaysLeft,
  isDateInYear,
  isDateInYearMonth,
  isMonthlyUnlimitedSubscription,
} from "./utils";

export const ALL_LOCATIONS_KEY = "__all__";

export function isAllLocationsFilter(locationId: string): boolean {
  return locationId === ALL_LOCATIONS_KEY;
}

export function getSubscriptionLocationId(
  sub: Pick<Subscription, "priceId">,
  priceMap: Record<string, Price>
): string | null {
  if (!sub.priceId) return null;
  return priceMap[sub.priceId]?.locationId ?? null;
}

export function subscriptionMatchesClient(
  sub: Subscription,
  clientId: string,
  memberChanges: SubscriptionMemberChange[] = []
): boolean {
  if (sub.clientId1 === clientId || sub.clientId2 === clientId || sub.clientId3 === clientId) {
    return true;
  }
  return memberChanges.some(
    (c) =>
      c.subscriptionId === sub.id &&
      (c.outgoingClientId === clientId || c.incomingClientId === clientId)
  );
}

export function subscriptionMatchesClientAtDate(
  sub: Subscription,
  clientId: string,
  memberChanges: SubscriptionMemberChange[],
  asOfDate: string
): boolean {
  return clientIsSubscriptionMemberAtDate(sub, clientId, memberChanges, asOfDate);
}

export function isEndedSubscription(
  sub: Pick<Subscription, "lessonsLeft" | "billingModel" | "expiresAt" | "status">,
  asOfDate: string = new Date().toISOString().slice(0, 10)
): boolean {
  if (sub.status === "finished") return true;
  if (isMonthlyUnlimitedSubscription(sub)) {
    return Boolean(sub.expiresAt && sub.expiresAt < asOfDate);
  }
  return sub.lessonsLeft === 0;
}

export function matchesClientSearch(
  sub: Subscription,
  query: string,
  clientMap: Record<string, Client>
): boolean {
  const c1 = clientMap[sub.clientId1];
  const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
  const c3 = sub.clientId3 ? clientMap[sub.clientId3] : null;
  const queryStr = `${c1?.firstName || ""} ${c1?.lastName || ""} ${c2?.firstName || ""} ${c2?.lastName || ""} ${c3?.firstName || ""} ${c3?.lastName || ""}`.toLowerCase();
  return queryStr.includes(query.toLowerCase());
}

export function filterActiveSubscriptions(
  subs: Subscription[],
  opts: {
    search: string;
    clientMap: Record<string, Client>;
    locationId: string;
    disciplineId: string;
    scheduleGroupId: string;
    endingOnly: boolean;
    priceMap: Record<string, Price>;
    groupsBySubId: Record<string, SubscriptionGroupLink[]>;
    asOfDate?: string;
  }
): Subscription[] {
  const asOfDate = opts.asOfDate ?? new Date().toISOString().slice(0, 10);

  return subs.filter((sub) => {
    if (opts.search.trim() && !matchesClientSearch(sub, opts.search, opts.clientMap)) return false;
    if (opts.locationId && getSubscriptionLocationId(sub, opts.priceMap) !== opts.locationId) return false;
    if (opts.disciplineId && sub.disciplineId !== opts.disciplineId) return false;
    if (
      opts.scheduleGroupId &&
      !subscriptionMatchesScheduleGroup(sub.id, opts.scheduleGroupId, opts.groupsBySubId)
    ) {
      return false;
    }
    if (opts.endingOnly) {
      if (isMonthlyUnlimitedSubscription(sub)) {
        if (getSubscriptionDaysLeft(sub.expiresAt, asOfDate) > 2) return false;
      } else if (sub.lessonsLeft > 2) {
        return false;
      }
    }
    return true;
  });
}

export function filterHistorySubscriptions(
  subs: Subscription[],
  opts: {
    disciplineId: string;
    locationId: string;
    clientId: string;
    month: string;
    year: number;
    priceMap: Record<string, Price>;
    memberChanges?: SubscriptionMemberChange[];
  }
): Subscription[] {
  const memberChanges = opts.memberChanges ?? [];
  const hasFilter = Boolean(opts.disciplineId || opts.locationId || opts.clientId);
  if (!hasFilter) return [];

  let pool = subs;

  if (opts.clientId) {
    pool = pool.filter((s) => subscriptionMatchesClient(s, opts.clientId, memberChanges));
    pool = pool.filter((s) => isDateInYear(s.activationDate, opts.year));
  } else {
    pool = pool.filter((s) => isEndedSubscription(s));
    if (opts.disciplineId) {
      pool = pool.filter((s) => s.disciplineId === opts.disciplineId);
    }
    if (opts.locationId && !isAllLocationsFilter(opts.locationId)) {
      pool = pool.filter((s) => getSubscriptionLocationId(s, opts.priceMap) === opts.locationId);
    }
    pool = pool.filter((s) => isDateInYearMonth(s.activationDate, opts.month));
  }

  return pool.sort((a, b) => b.activationDate.localeCompare(a.activationDate));
}
