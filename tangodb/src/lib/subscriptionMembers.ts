import type { Client, Subscription, SubscriptionMemberChange } from "../types";
import { formatClientName } from "./utils";

export const PAIR_SUBSCRIPTION_TYPES = new Set(["pair", "pair_hm"]);

export function isPairGroupSubscription(sub: Pick<Subscription, "type" | "category">): boolean {
  return sub.category === "group" && PAIR_SUBSCRIPTION_TYPES.has(sub.type);
}

export function subscriptionMemberSlots(sub: Subscription): Array<{
  slot: number;
  clientId: string;
}> {
  const slots: Array<{ slot: number; clientId: string }> = [];
  if (sub.clientId1) slots.push({ slot: 1, clientId: sub.clientId1 });
  if (sub.clientId2) slots.push({ slot: 2, clientId: sub.clientId2 });
  if (sub.clientId3) slots.push({ slot: 3, clientId: sub.clientId3 });
  if (sub.clientId4) slots.push({ slot: 4, clientId: sub.clientId4 });
  return slots;
}

/** Undo applied changes after asOfDate to reconstruct historical composition. */
export function subscriptionClientIdsAtDate(
  sub: Subscription,
  changes: SubscriptionMemberChange[],
  asOfDate: string
): string[] {
  let ids = subscriptionMemberSlots(sub).map((s) => s.clientId);

  const undoChanges = changes
    .filter((c) => c.status === "applied" && c.effectiveDate > asOfDate)
    .sort((a, b) => {
      const byDate = b.effectiveDate.localeCompare(a.effectiveDate);
      if (byDate !== 0) return byDate;
      return b.createdAt.localeCompare(a.createdAt);
    });

  for (const change of undoChanges) {
    ids = ids.map((id) => (id === change.incomingClientId ? change.outgoingClientId : id));
  }

  return [...new Set(ids.filter(Boolean))];
}

export function clientIsSubscriptionMemberAtDate(
  sub: Subscription,
  clientId: string,
  changes: SubscriptionMemberChange[],
  asOfDate: string
): boolean {
  return subscriptionClientIdsAtDate(sub, changes, asOfDate).includes(clientId);
}

export function clientIsActiveSubscriptionMember(
  sub: Subscription,
  clientId: string,
  changes: SubscriptionMemberChange[],
  asOfDate: string = new Date().toISOString().slice(0, 10)
): boolean {
  if (sub.status === "finished") {
    return clientIsSubscriptionMemberAtDate(sub, clientId, changes, asOfDate);
  }
  if (!clientIsSubscriptionMemberAtDate(sub, clientId, changes, asOfDate)) {
    return false;
  }
  const lastChange = changes
    .filter(
      (c) =>
        c.status === "applied" &&
        (c.outgoingClientId === clientId || c.incomingClientId === clientId)
    )
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  if (lastChange?.outgoingClientId === clientId && lastChange.effectiveDate <= asOfDate) {
    return false;
  }
  return true;
}

export function formatSubscriptionMembersAtDate(
  sub: Subscription,
  changes: SubscriptionMemberChange[],
  clientMap: Record<string, Client>,
  asOfDate: string
): string {
  return subscriptionClientIdsAtDate(sub, changes, asOfDate)
    .map((id) => {
      const client = clientMap[id];
      return client ? formatClientName(client.lastName, client.firstName) : id;
    })
    .join(" & ");
}

export function getScheduledMemberChangesForSubscription(
  changes: SubscriptionMemberChange[],
  subscriptionId: string
): SubscriptionMemberChange[] {
  return changes.filter(
    (c) => c.subscriptionId === subscriptionId && c.status === "scheduled"
  );
}
