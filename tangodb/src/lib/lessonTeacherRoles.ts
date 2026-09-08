import type { MemberRole } from "../types/organization";

/** Roles that may be assigned as the conducting teacher on lessons. */
export const LESSON_CONDUCTING_ROLES: readonly MemberRole[] = ["owner", "director", "teacher"];

export function memberCanConductLessons(role: MemberRole): boolean {
  return (LESSON_CONDUCTING_ROLES as readonly string[]).includes(role);
}

export function isActiveLessonConductingMember(member: {
  role: MemberRole;
  is_active: boolean;
}): boolean {
  return member.is_active && memberCanConductLessons(member.role);
}
