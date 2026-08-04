import type { Client, Subscription, SubscriptionMemberChange } from "../types";
import { formatClientName } from "./utils";
import { supabase } from "./supabase";

export const PAIR_SUBSCRIPTION_TYPES = new Set(["pair", "pair_hm"]);

export function isPairGroupSubscription(sub: Pick<Subscription, "type" | "category">): boolean {
  return sub.category === "group" && PAIR_SUBSCRIPTION_TYPES.has(sub.type);
}

/** Group attendance is marked per subscription; pair types represent two people. */
export function groupSubscriptionParticipantCount(type: string): number {
  return PAIR_SUBSCRIPTION_TYPES.has(type) ? 2 : 1;
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

export function buildMemberChangesBySubId(
  changes: SubscriptionMemberChange[]
): Record<string, SubscriptionMemberChange[]> {
  const map: Record<string, SubscriptionMemberChange[]> = {};
  for (const change of changes) {
    const bucket = map[change.subscriptionId] ?? [];
    bucket.push(change);
    map[change.subscriptionId] = bucket;
  }
  return map;
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
  if (sub.status !== "active") {
    return false;
  }

  const pendingJoin = changes.find(
    (c) =>
      c.subscriptionId === sub.id &&
      c.status === "scheduled" &&
      c.incomingClientId === clientId &&
      c.effectiveDate > asOfDate
  );
  if (pendingJoin) {
    return false;
  }

  return clientIsSubscriptionMemberAtDate(sub, clientId, changes, asOfDate);
}

export function clientEverParticipatedInSubscription(
  sub: Subscription,
  clientId: string,
  changes: SubscriptionMemberChange[]
): boolean {
  if (subscriptionMemberSlots(sub).some((s) => s.clientId === clientId)) {
    return true;
  }
  return changes.some(
    (c) =>
      c.subscriptionId === sub.id &&
      (c.outgoingClientId === clientId || c.incomingClientId === clientId)
  );
}

export type ClientSubscriptionParticipation = {
  subscription: Subscription;
  isActive: boolean;
  fromDate: string;
  toDate: string | null;
};

export function resolveClientSubscriptionParticipations(
  clientId: string,
  subscriptions: Subscription[],
  changes: SubscriptionMemberChange[],
  asOfDate: string = new Date().toISOString().slice(0, 10)
): ClientSubscriptionParticipation[] {
  const subs = subscriptions.filter((sub) => clientEverParticipatedInSubscription(sub, clientId, changes));

  return subs
    .map((sub) => {
      const subChanges = changes
        .filter((c) => c.subscriptionId === sub.id)
        .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

      const joinedViaChange = subChanges.find(
        (c) => c.incomingClientId === clientId && (c.status === "applied" || c.status === "scheduled")
      );
      const leftViaChange = subChanges.find(
        (c) =>
          c.outgoingClientId === clientId &&
          (c.status === "applied" || c.status === "scheduled") &&
          c.effectiveDate <= asOfDate
      );

      const fromDate = joinedViaChange?.effectiveDate ?? sub.activationDate;
      let toDate: string | null = null;
      if (leftViaChange && leftViaChange.status === "applied") {
        toDate = leftViaChange.effectiveDate;
      } else if (sub.status === "finished") {
        toDate = asOfDate;
      }

      return {
        subscription: sub,
        isActive: clientIsActiveSubscriptionMember(sub, clientId, subChanges, asOfDate),
        fromDate,
        toDate,
      };
    })
    .sort((a, b) => b.subscription.activationDate.localeCompare(a.subscription.activationDate));
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

export function resolveSubscriptionMemberNamesAtDate(
  sub: Subscription,
  changes: SubscriptionMemberChange[],
  clientMap: Record<string, Client>,
  asOfDate: string
): { client1: string; client2: string; client3: string } {
  const ids = subscriptionClientIdsAtDate(sub, changes, asOfDate);
  const nameFor = (id?: string) => {
    if (!id) return "";
    const client = clientMap[id];
    return client ? formatClientName(client.lastName, client.firstName) : id;
  };
  return {
    client1: nameFor(ids[0]),
    client2: nameFor(ids[1]),
    client3: nameFor(ids[2]),
  };
}

export function getScheduledMemberChangesForSubscription(
  changes: SubscriptionMemberChange[],
  subscriptionId: string
): SubscriptionMemberChange[] {
  return changes.filter(
    (c) => c.subscriptionId === subscriptionId && c.status === "scheduled"
  );
}

export async function applyScheduledSubscriptionMemberChanges(): Promise<void> {
  await supabase.rpc("apply_scheduled_subscription_member_changes");
}
