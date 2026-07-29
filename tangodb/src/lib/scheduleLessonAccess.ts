import type { MemberRole, OrgModules } from "../types/organization";
import type { DisplayLesson, PersonalDisplayLesson } from "../types";
import { isModuleEnabled } from "./orgModules";
import { isPastDate, isPersonalLessonLockedForWrite } from "./scheduleWeek";
import type { PermissionAction } from "./permissions";

type CanFn = (action: PermissionAction, context?: { disciplineId?: string | null; locationId?: string | null }) => boolean;

function lessonContext(lesson: DisplayLesson) {
  return {
    disciplineId: lesson.kind === "event" ? null : lesson.disciplineId,
    locationId: lesson.locationId,
  };
}

export function canManageGroupLesson(role: MemberRole | null, lessonDate: string, isReadOnly: boolean): boolean {
  if (isReadOnly) return false;
  if (isPastDate(lessonDate)) return false;
  return role === "owner" || role === "director";
}

export function canPayPersonalLesson(
  _role: MemberRole | null,
  _memberId: string | null,
  lesson: PersonalDisplayLesson,
  can: CanFn,
  isReadOnly: boolean
): boolean {
  if (isReadOnly) return false;
  if (lesson.paid === "yes") return false;
  return can("payments.write", lessonContext(lesson));
}

export function canWritePersonalLesson(
  role: MemberRole | null,
  memberId: string | null,
  lesson: PersonalDisplayLesson,
  can: CanFn,
  isReadOnly: boolean
): boolean {
  if (isReadOnly) return false;
  if (isPersonalLessonLockedForWrite(lesson.date)) return false;
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

export interface ScheduleGridAddOptions {
  isReadOnly: boolean;
  modules: OrgModules;
  teachersCanSellSubscriptions?: boolean;
}

export function canOfferGroupLessonAdd(
  role: MemberRole | null,
  can: CanFn,
  options: ScheduleGridAddOptions,
  context?: { disciplineId?: string | null; locationId?: string | null }
): boolean {
  if (options.isReadOnly) return false;
  if (!isModuleEnabled(options.modules, "group_subscriptions")) return false;
  if (!can("schedule.write", context)) return false;

  if (role === "owner" || role === "director") return true;

  if (role === "teacher") {
    return options.teachersCanSellSubscriptions ?? false;
  }

  return false;
}

export function canAddPersonalFromGrid(
  role: MemberRole | null,
  can: CanFn,
  options: ScheduleGridAddOptions,
  context?: { disciplineId?: string | null; locationId?: string | null }
): boolean {
  if (options.isReadOnly) return false;
  if (!isModuleEnabled(options.modules, "personal_lessons")) return false;
  return can("personal_lessons.write", context);
}

export function canClickEmptyCell(
  role: MemberRole | null,
  can: CanFn,
  options: ScheduleGridAddOptions,
  context?: { disciplineId?: string | null; locationId?: string | null }
): boolean {
  return (
    canOfferGroupLessonAdd(role, can, options, context) ||
    canAddPersonalFromGrid(role, can, options, context)
  );
}
