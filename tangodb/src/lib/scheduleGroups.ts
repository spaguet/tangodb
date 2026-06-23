import type { ScheduleSlot, SubscriptionGroupLink } from "../types";

export interface ScheduleGroupOption {
  key: string;
  groupName: string;
  disciplineId: string | null;
  locationId: string | null;
  displayName: string;
}

export function scheduleGroupKey(parts: {
  locationId?: string | null;
  groupName?: string;
  disciplineId?: string | null;
}): string {
  const locationId = parts.locationId ?? "none";
  const groupName = (parts.groupName ?? "").trim();
  const disciplineId = parts.disciplineId ?? "none";
  return `${locationId}::${groupName}::${disciplineId}`;
}

export function parseScheduleGroupKey(key: string): {
  locationId: string | null;
  groupName: string;
  disciplineId: string | null;
} {
  const [loc, name, disc] = key.split("::");
  return {
    locationId: loc === "none" ? null : loc,
    groupName: name ?? "",
    disciplineId: disc === "none" ? null : disc,
  };
}

export function subscriptionGroupLinkKey(link: SubscriptionGroupLink): string {
  return scheduleGroupKey(link);
}

export function isActiveScheduleSlot(slot: ScheduleSlot): boolean {
  return slot.validTo == null;
}

export function listScheduleGroups(
  slots: ScheduleSlot[],
  filters?: { disciplineId?: string | null; locationId?: string | null }
): ScheduleGroupOption[] {
  const map = new Map<string, ScheduleGroupOption>();

  for (const slot of slots) {
    if (!isActiveScheduleSlot(slot)) continue;
    if (filters?.disciplineId && slot.disciplineId !== filters.disciplineId) continue;
    if (filters?.locationId != null && filters.locationId !== "" && (slot.locationId ?? null) !== filters.locationId) {
      continue;
    }

    const key = scheduleGroupKey(slot);
    if (map.has(key)) continue;

    const displayName = slot.groupName?.trim() || "Группа";
    map.set(key, {
      key,
      groupName: slot.groupName?.trim() ?? "",
      disciplineId: slot.disciplineId ?? null,
      locationId: slot.locationId ?? null,
      displayName,
    });
  }

  return Array.from(map.values()).sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
}

export function subscriptionMatchesScheduleGroup(
  subId: string,
  groupKey: string,
  groupsBySubId: Record<string, SubscriptionGroupLink[]>
): boolean {
  const links = groupsBySubId[subId];
  if (!links || links.length === 0) return true;
  return links.some((link) => subscriptionGroupLinkKey(link) === groupKey);
}

export function getSubscriptionGroupDisplayNames(
  subId: string,
  groupsBySubId: Record<string, SubscriptionGroupLink[]>,
  groupLabelByKey: Record<string, string>
): string[] {
  const links = groupsBySubId[subId] ?? [];
  if (links.length === 0) return [];

  return links
    .map((link) => groupLabelByKey[subscriptionGroupLinkKey(link)] ?? (link.groupName.trim() || "Группа"))
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b, "ru"));
}
