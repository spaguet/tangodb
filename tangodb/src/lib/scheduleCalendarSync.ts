import type { DisplayLesson } from "../types";
import type { ScheduleCalendarSyncLabel } from "./googleCalendarApi";

export function scheduleCalendarSyncLookupKey(lesson: DisplayLesson): string | null {
  if (lesson.kind === "personal") {
    return `personal_lesson:${lesson.lessonId}:${lesson.date}`;
  }
  if (lesson.kind === "group") {
    return `group_occurrence:${lesson.slotId}:${lesson.date}`;
  }
  if (lesson.kind === "event") {
    return `event_session:${lesson.sessionId}:${lesson.date}`;
  }
  return null;
}

export function buildScheduleCalendarSyncMap(
  labels: ScheduleCalendarSyncLabel[]
): Map<string, ScheduleCalendarSyncLabel> {
  const map = new Map<string, ScheduleCalendarSyncLabel>();
  for (const row of labels) {
    map.set(`${row.source_type}:${row.source_id}:${row.occurrence_date}`, row);
  }
  return map;
}

export function resolveScheduleLessonCalendarName(
  lesson: DisplayLesson,
  map: Map<string, ScheduleCalendarSyncLabel>
): string | undefined {
  const key = scheduleCalendarSyncLookupKey(lesson);
  if (!key) return undefined;
  return map.get(key)?.calendar_name ?? undefined;
}
