import type { DisplayLesson } from "../types";
import type { EditionCapability } from "./orgEdition";
import { isPastDate } from "./scheduleWeek";

export type EditionOccupancyUpsell = "pro" | "studio";

export function editionCapabilityForLesson(lesson: DisplayLesson): EditionCapability | null {
  switch (lesson.kind) {
    case "rental":
      return "hall_rent";
    case "personal":
      return "personal_lessons";
    case "event":
      return "calendar_events";
    default:
      return null;
  }
}

export function upsellTierForCapability(capability: EditionCapability): EditionOccupancyUpsell {
  return capability === "personal_lessons" ? "studio" : "pro";
}

export function isEditionOccupancyLeftover(
  lesson: DisplayLesson,
  editionAllows: (capability: EditionCapability) => boolean
): boolean {
  if (lesson.scheduleRestricted) return false;
  const capability = editionCapabilityForLesson(lesson);
  if (!capability) return false;
  return !editionAllows(capability);
}

export function withEditionOccupancyFields(
  lesson: DisplayLesson,
  editionAllows: (capability: EditionCapability) => boolean
): DisplayLesson {
  if (lesson.scheduleRestricted) return lesson;
  const capability = editionCapabilityForLesson(lesson);
  if (!capability || editionAllows(capability)) return lesson;
  return {
    ...lesson,
    editionOccupancy: true,
    editionOccupancyUpsell: upsellTierForCapability(capability),
  };
}

/** Future calendar date (today included) — occupancy release allowed. */
export function isFutureScheduleDateForOccupancyRelease(dateISO: string): boolean {
  return !isPastDate(dateISO);
}

export function canOccupancyReleaseLesson(lesson: DisplayLesson): boolean {
  if (!lesson.editionOccupancy) return false;
  if (!isFutureScheduleDateForOccupancyRelease(lesson.date)) return false;
  if (lesson.kind === "rental") return lesson.bookingStatus === "confirmed";
  return lesson.kind === "personal" || lesson.kind === "event";
}
