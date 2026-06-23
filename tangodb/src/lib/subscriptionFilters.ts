import type { Client, Price, Subscription } from "../types";
import { isDateInYear, isDateInYearMonth } from "./utils";

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

export function subscriptionMatchesClient(sub: Subscription, clientId: string): boolean {
  return sub.clientId1 === clientId || sub.clientId2 === clientId || sub.clientId3 === clientId;
}

export function isEndedSubscription(sub: Pick<Subscription, "lessonsLeft">): boolean {
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
    endingOnly: boolean;
    priceMap: Record<string, Price>;
  }
): Subscription[] {
  return subs.filter((sub) => {
    if (opts.search.trim() && !matchesClientSearch(sub, opts.search, opts.clientMap)) return false;
    if (opts.locationId && getSubscriptionLocationId(sub, opts.priceMap) !== opts.locationId) return false;
    if (opts.disciplineId && sub.disciplineId !== opts.disciplineId) return false;
    if (opts.endingOnly && sub.lessonsLeft > 2) return false;
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
  }
): Subscription[] {
  const hasFilter = Boolean(opts.disciplineId || opts.locationId || opts.clientId);
  if (!hasFilter) return [];

  let pool = subs;

  if (opts.clientId) {
    pool = pool.filter((s) => subscriptionMatchesClient(s, opts.clientId));
    pool = pool.filter((s) => isDateInYear(s.activationDate, opts.year));
  } else {
    pool = pool.filter(isEndedSubscription);
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
