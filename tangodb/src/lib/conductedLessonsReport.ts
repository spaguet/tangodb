import type { ConductedLessonReportRow } from "../types";

export function currentCalendarWeekRange(): { dateFrom: string; dateTo: string } {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const isoDow = now.getDay() === 0 ? 7 : now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - (isoDow - 1));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const format = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  };

  return { dateFrom: format(weekStart), dateTo: format(weekEnd) };
}

export function conductedLessonsReportFilename(dateFrom: string, dateTo: string): string {
  return `lessons_${dateFrom}_${dateTo}.csv`;
}

export function mapConductedLessonReportRow(row: Record<string, unknown>): ConductedLessonReportRow {
  return {
    occurrenceId: String(row.occurrence_id ?? ""),
    slotId: String(row.slot_id ?? ""),
    scheduleGroupId: row.schedule_group_id ? String(row.schedule_group_id) : null,
    date: String(row.date ?? ""),
    dayOfWeek: Number(row.day_of_week ?? 0),
    timeStart: String(row.time_start ?? ""),
    timeEnd: String(row.time_end ?? ""),
    disciplineCategory: String(row.discipline_category ?? ""),
    disciplineId: String(row.discipline_id ?? ""),
    disciplineName: String(row.discipline_name ?? ""),
    groupName: String(row.group_name ?? ""),
    teacherName: String(row.teacher_name ?? ""),
    locationName: String(row.location_name ?? ""),
    presentCount: Number(row.present_count ?? 0),
    absentCount: Number(row.absent_count ?? 0),
    freezeCount: Number(row.freeze_count ?? 0),
  };
}

export function sortConductedLessonRows(rows: ConductedLessonReportRow[]): ConductedLessonReportRow[] {
  return [...rows].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.timeStart.localeCompare(b.timeStart) ||
      a.locationName.localeCompare(b.locationName) ||
      a.groupName.localeCompare(b.groupName)
  );
}

export function uniqueDisciplineCategories(
  disciplines: Array<{ category?: string | null }>
): string[] {
  const set = new Set<string>();
  for (const d of disciplines) {
    const trimmed = d.category?.trim();
    if (trimmed) set.add(trimmed);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "ru"));
}

export function disciplineIdsForCategory(
  disciplines: Array<{ id: string; category?: string | null }>,
  category: string | null
): string[] {
  if (!category?.trim()) return disciplines.map((d) => d.id);
  const normalized = category.trim().toLowerCase();
  return disciplines
    .filter((d) => (d.category?.trim().toLowerCase() ?? "") === normalized)
    .map((d) => d.id);
}
