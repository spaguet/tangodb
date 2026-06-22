import { minutesToTime, normalizeTime, timeToMinutes } from "./scheduleWeek";

export function validateTimeRange(timeStart: string, timeEnd: string): string | null {
  try {
    if (timeToMinutes(timeEnd) <= timeToMinutes(timeStart)) {
      return "Время окончания должно быть позже начала";
    }
  } catch {
    return "Укажите корректное время";
  }
  return null;
}

/** Default +60 min, trimmed to the start of the next lesson on the same day. */
export function computeAutoTimeEnd(
  timeStart: string,
  sameDayLessons: Array<{ timeStart: string; timeEnd: string }>
): string {
  const startMin = timeToMinutes(normalizeTime(timeStart));
  let endMin = Math.min(startMin + 60, 23 * 60 + 45);

  for (const lesson of sameDayLessons) {
    const lessonStart = timeToMinutes(lesson.timeStart);
    if (lessonStart > startMin && lessonStart < endMin) {
      endMin = lessonStart;
    }
  }

  if (endMin <= startMin) {
    endMin = Math.min(startMin + 60, 23 * 60 + 45);
  }

  return minutesToTime(endMin);
}
