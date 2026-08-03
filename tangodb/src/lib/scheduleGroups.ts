import { expandSlotsToDateRange } from "./scheduleWeek";
import type { GroupCapacitySnapshot, ScheduleGroup, ScheduleSlot, SubscriptionGroupLink } from "../types";

/** Days before/after today when listing groups for subscription sale. */
export const SUBSCRIPTION_SALE_GROUP_SCHEDULE_DAYS = 30;

export interface ScheduleGroupOption {
  id: string;
  name: string;
  disciplineId: string;
  locationId: string | null;
  displayName: string;
  maxCapacity: number | null;
  occupied: number | null;
  hasLimit: boolean;
  isFull: boolean;
}

export function isActiveScheduleSlot(slot: ScheduleSlot): boolean {
  return slot.validTo == null;
}

export function mapScheduleGroup(row: Record<string, unknown>): ScheduleGroup {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "",
    disciplineId: row.discipline_id as string,
    locationId: row.default_location_id != null ? String(row.default_location_id) : null,
    maxCapacity: row.max_capacity != null ? Number(row.max_capacity) : null,
  };
}

export function getScheduleGroupIdsInDateRange(
  slots: ScheduleSlot[],
  rangeStartISO: string,
  rangeEndISO: string
): Set<string> {
  const lessons = expandSlotsToDateRange(slots, rangeStartISO, rangeEndISO);
  const ids = new Set<string>();
  for (const lesson of lessons) {
    if (lesson.scheduleGroupId) ids.add(lesson.scheduleGroupId);
  }
  return ids;
}

export function filterGroupsScheduledInDateRange(
  groups: ScheduleGroup[],
  slots: ScheduleSlot[],
  rangeStartISO: string,
  rangeEndISO: string
): ScheduleGroup[] {
  const scheduledIds = getScheduleGroupIdsInDateRange(slots, rangeStartISO, rangeEndISO);
  return groups.filter((group) => scheduledIds.has(group.id));
}

export function listScheduleGroupOptions(
  groups: ScheduleGroup[],
  filters?: { disciplineId?: string | null; locationId?: string | null },
  capacityByGroupId?: Record<string, Pick<GroupCapacitySnapshot, "occupied" | "hasLimit" | "isFull">>
): ScheduleGroupOption[] {
  return groups
    .filter((group) => {
      if (filters?.disciplineId && group.disciplineId !== filters.disciplineId) return false;
      if (
        filters?.locationId != null &&
        filters.locationId !== "" &&
        (group.locationId ?? null) !== filters.locationId
      ) {
        return false;
      }
      return true;
    })
    .map((group) => {
      const capacity = capacityByGroupId?.[group.id];
      return {
        id: group.id,
        name: group.name,
        disciplineId: group.disciplineId,
        locationId: group.locationId,
        displayName: group.name.trim() || "Группа",
        maxCapacity: group.maxCapacity,
        occupied: capacity?.occupied ?? null,
        hasLimit: group.maxCapacity != null,
        isFull: capacity?.isFull ?? false,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
}

export function subscriptionMatchesScheduleGroup(
  subId: string,
  scheduleGroupId: string,
  groupsBySubId: Record<string, SubscriptionGroupLink[]>
): boolean {
  const links = groupsBySubId[subId];
  if (!links || links.length === 0) return false;
  return links.some((link) => link.scheduleGroupId === scheduleGroupId);
}

export function getSubscriptionGroupDisplayNames(
  subId: string,
  groupsBySubId: Record<string, SubscriptionGroupLink[]>,
  groupNameById: Record<string, string>
): string[] {
  const links = groupsBySubId[subId] ?? [];
  if (links.length === 0) return [];

  return links
    .map((link) => groupNameById[link.scheduleGroupId] ?? "Группа")
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .sort((a, b) => a.localeCompare(b, "ru"));
}

export function buildGroupNameById(groups: ScheduleGroup[]): Record<string, string> {
  return Object.fromEntries(
    groups.map((group) => [group.id, group.name.trim() || "Группа"])
  );
}
