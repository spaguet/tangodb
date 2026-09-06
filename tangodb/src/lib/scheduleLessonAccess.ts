import type { MemberRole, OrgModules, TeacherScope } from "../types/organization";
import type { DisplayLesson, PersonalDisplayLesson } from "../types";
import { personalLessonHasScheduleDebt } from "./personalLessonPayment";
import { t } from "./i18n";
import { isModuleEnabled } from "./orgModules";
import { isPersonalLessonLockedForWrite, isScheduleDateLockedForWrite } from "./scheduleWeek";
import type { PermissionAction } from "./permissions";
import { teacherMatchesContext } from "./permissions";

type CanFn = (action: PermissionAction, context?: { disciplineId?: string | null; locationId?: string | null }) => boolean;

function lessonContext(lesson: DisplayLesson) {
  return {
    disciplineId: lesson.kind === "event" || lesson.kind === "rental" ? null : lesson.disciplineId,
    locationId: lesson.locationId,
  };
}

export function canManageGroupLesson(
  role: MemberRole | null,
  lessonDate: string,
  isReadOnly: boolean,
  canEditPastSchedule = false
): boolean {
  if (isReadOnly) return false;
  if (isScheduleDateLockedForWrite(lessonDate, canEditPastSchedule)) return false;
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
  if (!personalLessonHasScheduleDebt(lesson)) return false;
  return can("payments.write", lessonContext(lesson));
}

export function canWritePersonalLesson(
  role: MemberRole | null,
  memberId: string | null,
  lesson: PersonalDisplayLesson,
  can: CanFn,
  isReadOnly: boolean,
  canEditPastSchedule = false
): boolean {
  if (isReadOnly) return false;
  if (isPersonalLessonLockedForWrite(lesson.date, canEditPastSchedule)) return false;
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
  if (!canReadClients) {
    return t(null, "common.client");
  }
  const display = clientDisplay?.trim();
  if (!isSpecifiedClientDisplay(display)) {
    return t(null, "schedule.lessonInfo.clientNotSpecified");
  }
  return display;
}

function isSpecifiedClientDisplay(display: string | undefined): display is string {
  if (!display) return false;
  return (
    display !== "schedule.lessonInfo.clientNotSpecified" &&
    display !== t(null, "schedule.lessonInfo.clientNotSpecified")
  );
}

export function canShowPaidStatus(role: MemberRole | null): boolean {
  return role === "owner" || role === "director" || role === "admin" || role === "teacher";
}

export interface ScheduleGridAddOptions {
  isReadOnly: boolean;
  modules: OrgModules;
  teachersCanAddGroupLessons?: boolean;
}

export function isLessonInTeacherScope(
  role: MemberRole | null,
  memberId: string | null,
  lesson: DisplayLesson,
  scope: TeacherScope
): boolean {
  if (role !== "teacher") return true;
  if (lesson.scheduleRestricted) return false;

  if (lesson.kind === "personal" || lesson.kind === "group") {
    if (memberId && lesson.teacherMemberId === memberId) return true;
    return teacherMatchesContext(scope, lessonContext(lesson));
  }

  if (lesson.kind === "event" || lesson.kind === "rental") {
    return teacherMatchesContext(scope, { locationId: lesson.locationId });
  }

  return true;
}

export function canViewLessonDetails(
  role: MemberRole | null,
  memberId: string | null,
  lesson: DisplayLesson,
  scope: TeacherScope
): boolean {
  return isLessonInTeacherScope(role, memberId, lesson, scope);
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
    return options.teachersCanAddGroupLessons ?? false;
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
