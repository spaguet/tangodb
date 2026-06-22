import type { MemberRole } from "../types/organization";
import type { DisplayLesson, PersonalDisplayLesson } from "../types";
import { isPastDate } from "./scheduleWeek";
import type { PermissionAction } from "./permissions";

type CanFn = (action: PermissionAction, context?: { disciplineId?: string | null; locationId?: string | null }) => boolean;

function lessonContext(lesson: DisplayLesson) {
  return {
    disciplineId: lesson.disciplineId,
    locationId: lesson.locationId,
  };
}

export function canManageGroupLesson(role: MemberRole | null, lessonDate: string, isReadOnly: boolean): boolean {
  if (isReadOnly) return false;
  if (isPastDate(lessonDate)) return false;
  return role === "owner" || role === "director";
}

export function canWritePersonalLesson(
  role: MemberRole | null,
  memberId: string | null,
  lesson: PersonalDisplayLesson,
  can: CanFn,
  isReadOnly: boolean
): boolean {
  if (isReadOnly) return false;
  if (isPastDate(lesson.date)) return false;
  if (!can("personal_lessons.write", lessonContext(lesson))) return false;
  if (role === "teacher") {
    return Boolean(memberId && lesson.teacherMemberId === memberId);
  }
  return role === "owner" || role === "director" || role === "admin";
}

export function canReadLessonClients(
  role: MemberRole | null,
  lesson: DisplayLesson,
  can: CanFn
): boolean {
  if (role === "owner" || role === "director" || role === "admin") return true;
  return can("clients.read", lessonContext(lesson));
}

export function maskClientDisplay(
  clientDisplay: string | undefined,
  canReadClients: boolean
): string {
  if (canReadClients) {
    return clientDisplay && clientDisplay !== "Клиент не указан" ? clientDisplay : "Клиент не указан";
  }
  return "Клиент";
}

export function canShowPaidStatus(role: MemberRole | null): boolean {
  return role === "owner" || role === "director" || role === "admin" || role === "teacher";
}
