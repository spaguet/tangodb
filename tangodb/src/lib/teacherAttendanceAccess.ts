import type { MemberRole, TeacherScope } from "../types/organization";
import { hasScheduleGroupAccess } from "./teacherScope";

export interface AttendanceLessonAccessOptions {
  directorsCanMarkAttendance?: boolean;
}

export function canViewGroupAttendanceLesson(
  role: MemberRole | null,
  memberId: string | null,
  scope: TeacherScope,
  lesson: {
    scheduleGroupId?: string | null;
    teacherMemberId?: string | null;
    substituteTeacherMemberId?: string | null;
  },
  options?: AttendanceLessonAccessOptions
): boolean {
  if (!role) return false;
  if (role === "owner") return true;
  if (role === "director") return options?.directorsCanMarkAttendance ?? true;
  if (role === "admin") return true;
  if (role !== "teacher" || !memberId) return false;
  if (lesson.substituteTeacherMemberId === memberId) return true;
  if (!lesson.scheduleGroupId) return false;
  return hasScheduleGroupAccess(scope, lesson.scheduleGroupId);
}

export function canViewPersonalAttendanceLesson(
  role: MemberRole | null,
  memberId: string | null,
  lesson: { teacherMemberId?: string | null; substituteTeacherMemberId?: string | null },
  options?: AttendanceLessonAccessOptions
): boolean {
  if (!role) return false;
  if (role === "owner") return true;
  if (role === "director") return options?.directorsCanMarkAttendance ?? true;
  if (role === "admin") return true;
  if (role !== "teacher" || !memberId) return false;
  return lesson.teacherMemberId === memberId || lesson.substituteTeacherMemberId === memberId;
}
