import type { MemberRole } from "../types/organization";
import type {
  GroupDisplayLesson,
  PersonalDisplayLesson,
  PersonalLesson,
} from "../types";
import { supabase } from "./supabase";

export type LessonOccurrenceKind = "group" | "personal";

export interface LessonSubstituteRow {
  id: string;
  occurrenceKind: LessonOccurrenceKind;
  occurrenceDate: string;
  scheduleSlotId: string | null;
  personalLessonId: string | null;
  originalTeacherMemberId: string;
  substituteTeacherMemberId: string;
  locationId?: string | null;
}

export interface AssignLessonSubstituteInput {
  occurrenceKind: LessonOccurrenceKind;
  occurrenceDate: string;
  scheduleSlotId?: string | null;
  personalLessonId?: string | null;
  substituteMemberId: string;
  idempotencyKey?: string;
}

export interface ClearLessonSubstituteInput {
  occurrenceKind: LessonOccurrenceKind;
  occurrenceDate: string;
  scheduleSlotId?: string | null;
  personalLessonId?: string | null;
  idempotencyKey?: string;
}

type RpcResult =
  | { success: true; alreadyApplied?: boolean }
  | { success: false; error: string };

function asRpcResult(data: unknown, fallback: string): RpcResult {
  const row = data as {
    success?: boolean;
    error?: string;
    already_applied?: boolean;
  } | null;
  if (!row?.success) {
    return { success: false, error: row?.error ?? fallback };
  }
  return { success: true, alreadyApplied: row.already_applied ?? false };
}

function nestedLocationId(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return null;
  const locationId = (row as { location_id?: unknown }).location_id;
  return locationId != null ? String(locationId) : null;
}

export function mapLessonSubstituteRow(row: Record<string, unknown>): LessonSubstituteRow {
  const slot = row.schedule_slots;
  const personal = row.personal_lessons;
  return {
    id: String(row.id),
    occurrenceKind: row.occurrence_kind === "personal" ? "personal" : "group",
    occurrenceDate: String(row.occurrence_date).slice(0, 10),
    scheduleSlotId: row.schedule_slot_id != null ? String(row.schedule_slot_id) : null,
    personalLessonId: row.personal_lesson_id != null ? String(row.personal_lesson_id) : null,
    originalTeacherMemberId: String(row.original_teacher_member_id),
    substituteTeacherMemberId: String(row.substitute_teacher_member_id),
    locationId: nestedLocationId(slot) ?? nestedLocationId(personal),
  };
}

export async function fetchLessonSubstitutes(): Promise<LessonSubstituteRow[]> {
  const { data, error } = await supabase
    .from("lesson_occurrence_substitutes" as never)
    .select(
      "id, occurrence_kind, occurrence_date, schedule_slot_id, personal_lesson_id, original_teacher_member_id, substitute_teacher_member_id, schedule_slots!lesson_occurrence_substitutes_organization_id_schedule_slot_id_fkey(location_id), personal_lessons!lesson_occurrence_substitutes_organization_id_personal_lesson_id_fkey(location_id)"
    )
    .order("occurrence_date", { ascending: true });

  if (error) throw error;
  return ((data as unknown as Record<string, unknown>[] | null) ?? []).map(mapLessonSubstituteRow);
}

export async function assignLessonSubstituteRpc(
  input: AssignLessonSubstituteInput
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("assign_lesson_substitute" as never, {
    p_occurrence_kind: input.occurrenceKind,
    p_occurrence_date: input.occurrenceDate,
    p_schedule_slot_id: input.scheduleSlotId ?? null,
    p_personal_lesson_id: input.personalLessonId ?? null,
    p_substitute_member_id: input.substituteMemberId,
    p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
  } as never);

  if (error) return { success: false, error: error.message };
  return asRpcResult(data, "schedule.substitute.error.saveFailed");
}

export async function clearLessonSubstituteRpc(
  input: ClearLessonSubstituteInput
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("clear_lesson_substitute" as never, {
    p_occurrence_kind: input.occurrenceKind,
    p_occurrence_date: input.occurrenceDate,
    p_schedule_slot_id: input.scheduleSlotId ?? null,
    p_personal_lesson_id: input.personalLessonId ?? null,
    p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
  } as never);

  if (error) return { success: false, error: error.message };
  return asRpcResult(data, "schedule.substitute.error.clearFailed");
}

export function canAssignLessonSubstitute(args: {
  role: MemberRole | null;
  memberId: string | null;
  originalTeacherMemberId: string | null;
  isReadOnly: boolean;
  restrictedAdmin?: boolean;
}): boolean {
  if (args.isReadOnly) return false;
  if (!args.originalTeacherMemberId) return false;
  if (args.role === "owner" || args.role === "director") return true;
  if (args.role === "admin") return args.restrictedAdmin !== true;
  if (args.role === "teacher") {
    return Boolean(args.memberId && args.memberId === args.originalTeacherMemberId);
  }
  return false;
}

export function isSubstituteOnlyTeacher(
  role: MemberRole | null,
  memberId: string | null,
  lesson: { teacherMemberId?: string | null; substituteTeacherMemberId?: string | null }
): boolean {
  if (role !== "teacher" || !memberId) return false;
  if (lesson.substituteTeacherMemberId !== memberId) return false;
  return lesson.teacherMemberId !== memberId;
}

export function substituteLocationIds(
  rows: LessonSubstituteRow[],
  memberId: string | null
): string[] {
  if (!memberId) return [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.substituteTeacherMemberId !== memberId) continue;
    if (row.locationId) ids.add(row.locationId);
  }
  return [...ids];
}

export function applySubstitutesToGroupLessons<
  T extends { slotId?: string; date: string; substituteTeacherMemberId?: string | null },
>(lessons: T[], substitutes: LessonSubstituteRow[]): T[] {
  if (substitutes.length === 0) return lessons;
  const byKey = new Map<string, LessonSubstituteRow>();
  for (const row of substitutes) {
    if (row.occurrenceKind !== "group" || !row.scheduleSlotId) continue;
    byKey.set(`${row.scheduleSlotId}:${row.occurrenceDate}`, row);
  }
  return lessons.map((lesson) => {
    if (!lesson.slotId) return lesson;
    const row = byKey.get(`${lesson.slotId}:${lesson.date}`);
    if (!row) return lesson;
    return { ...lesson, substituteTeacherMemberId: row.substituteTeacherMemberId };
  });
}

export function applySubstitutesToPersonalLessons<
  T extends { id?: string; lessonId?: string; date: string; substituteTeacherMemberId?: string | null },
>(lessons: T[], substitutes: LessonSubstituteRow[]): T[] {
  if (substitutes.length === 0) return lessons;
  const byId = new Map<string, LessonSubstituteRow>();
  for (const row of substitutes) {
    if (row.occurrenceKind !== "personal" || !row.personalLessonId) continue;
    byId.set(row.personalLessonId, row);
  }
  return lessons.map((lesson) => {
    const id = lesson.lessonId ?? lesson.id;
    if (!id) return lesson;
    const row = byId.get(id);
    if (!row) return lesson;
    return { ...lesson, substituteTeacherMemberId: row.substituteTeacherMemberId };
  });
}

export function applySubstitutesToGroupDisplay(
  lessons: GroupDisplayLesson[],
  substitutes: LessonSubstituteRow[]
): GroupDisplayLesson[] {
  return applySubstitutesToGroupLessons(lessons, substitutes);
}

export function applySubstitutesToPersonalDisplay(
  lessons: PersonalDisplayLesson[],
  substitutes: LessonSubstituteRow[]
): PersonalDisplayLesson[] {
  return applySubstitutesToPersonalLessons(lessons, substitutes);
}

export function applySubstitutesToPersonalRecords(
  lessons: PersonalLesson[],
  substitutes: LessonSubstituteRow[]
): PersonalLesson[] {
  return applySubstitutesToPersonalLessons(lessons, substitutes);
}
