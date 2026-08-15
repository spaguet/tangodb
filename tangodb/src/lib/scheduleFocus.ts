import { getWeekRange } from "./scheduleWeek";
import type { DisplayLesson } from "../types";

export type ScheduleFocusParams = {
  date: string | null;
  lesson: string | null;
  rental: string | null;
  location: string | null;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function buildScheduleFocusPath(input: {
  date: string;
  lessonId?: string | null;
  rentalId?: string | null;
  locationId?: string | null;
}): string {
  const params = new URLSearchParams();
  params.set("date", input.date.slice(0, 10));
  if (input.lessonId) params.set("lesson", input.lessonId);
  if (input.rentalId) params.set("rental", input.rentalId);
  if (input.locationId) params.set("location", input.locationId);
  return `/schedule?${params.toString()}`;
}

export function parseScheduleFocusParams(searchParams: URLSearchParams): ScheduleFocusParams {
  const dateRaw = (searchParams.get("date") ?? "").trim();
  const date = ISO_DATE.test(dateRaw) ? dateRaw : null;
  const lesson = (searchParams.get("lesson") ?? "").trim() || null;
  const rental = (searchParams.get("rental") ?? "").trim() || null;
  const location = (searchParams.get("location") ?? "").trim() || null;
  return { date, lesson, rental, location };
}

export function weekStartFromFocusDate(date: string | null): Date {
  if (date && ISO_DATE.test(date)) {
    return getWeekRange(new Date(`${date}T12:00:00`)).weekStart;
  }
  return getWeekRange(new Date()).weekStart;
}

export function isFocusedDisplayLesson(
  lesson: DisplayLesson,
  focus: Pick<ScheduleFocusParams, "lesson" | "rental">
): boolean {
  if (focus.lesson && lesson.kind === "personal") return lesson.lessonId === focus.lesson;
  if (focus.rental && lesson.kind === "rental") return lesson.rentalId === focus.rental;
  return false;
}

export function paymentSchedulePath(input: {
  personalLessonId?: string | null;
  lessonDate?: string | null;
  locationId?: string | null;
  rentalId?: string | null;
  rentalDate?: string | null;
}): string | null {
  if (input.personalLessonId && input.lessonDate) {
    return buildScheduleFocusPath({
      date: input.lessonDate,
      lessonId: input.personalLessonId,
      locationId: input.locationId,
    });
  }
  if (input.rentalId && input.rentalDate) {
    return buildScheduleFocusPath({
      date: input.rentalDate,
      rentalId: input.rentalId,
      locationId: input.locationId,
    });
  }
  return null;
}
