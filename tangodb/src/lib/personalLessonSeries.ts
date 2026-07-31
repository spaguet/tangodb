import { jsDayToIsoDow } from "./utils";
import type { PersonalLesson } from "../types";

export type PersonalLessonSeriesFields = Pick<
  PersonalLesson,
  | "type"
  | "clientId1"
  | "clientId2"
  | "clientId3"
  | "clientId4"
  | "date"
  | "timeStart"
  | "timeEnd"
  | "teacherMemberId"
  | "locationId"
  | "disciplineId"
>;

function seriesDayOfWeek(date: string): number {
  return jsDayToIsoDow(new Date(`${date}T12:00:00`).getDay());
}

export function personalLessonSeriesKey(lesson: PersonalLessonSeriesFields): string {
  return [
    lesson.type,
    lesson.clientId1,
    lesson.clientId2,
    lesson.clientId3,
    lesson.clientId4 ?? "",
    lesson.timeStart,
    lesson.timeEnd,
    lesson.teacherMemberId ?? "",
    lesson.locationId ?? "",
    lesson.disciplineId ?? "",
    seriesDayOfWeek(lesson.date),
  ].join("\0");
}

export function isSamePersonalLessonSeries(
  a: PersonalLessonSeriesFields,
  b: PersonalLessonSeriesFields
): boolean {
  return personalLessonSeriesKey(a) === personalLessonSeriesKey(b);
}

export function personalLessonsInSeriesFromDate(
  anchor: PersonalLessonSeriesFields & { date: string },
  all: PersonalLesson[]
): PersonalLesson[] {
  return all.filter((lesson) => lesson.date >= anchor.date && isSamePersonalLessonSeries(anchor, lesson));
}
