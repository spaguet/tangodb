import { teacherHasAnyScopeAccess } from "./permissions";
import type { TeacherScope } from "../types/organization";
import { EMPTY_TEACHER_SCOPE } from "../types/organization";

/** Safe default when owner invites a teacher without narrowing scope. */
export const DEFAULT_TEACHER_INVITE_SCOPE: TeacherScope = {
  discipline_ids: [],
  location_ids: [],
  schedule_group_ids: [],
  all_disciplines: true,
  all_locations: true,
  all_groups: true,
  can_view_all_clients: false,
};

export function normalizeTeacherScope(raw: unknown): TeacherScope {
  if (!raw || typeof raw !== "object") return { ...EMPTY_TEACHER_SCOPE };
  const scope = raw as Partial<TeacherScope>;
  return {
    discipline_ids: Array.isArray(scope.discipline_ids)
      ? scope.discipline_ids.map(String)
      : [],
    location_ids: Array.isArray(scope.location_ids) ? scope.location_ids.map(String) : [],
    schedule_group_ids: Array.isArray(scope.schedule_group_ids)
      ? scope.schedule_group_ids.map(String)
      : [],
    all_disciplines: scope.all_disciplines === true,
    all_locations: scope.all_locations === true,
    all_groups: scope.all_groups === true,
    can_view_all_clients: scope.can_view_all_clients === true,
  };
}

export function hasScheduleGroupAccess(scope: TeacherScope, groupId?: string | null): boolean {
  if (!groupId) return false;
  if (scope.all_groups) return true;
  return scope.schedule_group_ids.includes(groupId);
}

export function isTeacherScopeConfigured(scope: TeacherScope): boolean {
  return teacherHasAnyScopeAccess(scope);
}
