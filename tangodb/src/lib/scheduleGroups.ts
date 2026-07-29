import type { GroupCapacitySnapshot, ScheduleGroup, ScheduleSlot, SubscriptionGroupLink } from "../types";

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
