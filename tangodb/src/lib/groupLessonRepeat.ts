import { addDays } from "./scheduleWeek";

export type GroupRepeatEndMode = "weeks" | "date";

export interface GroupRepeatConfig {
  repeatWeekly: boolean;
  endMode: GroupRepeatEndMode;
  weekCount: number;
  endDate: string;
}

export function defaultGroupRepeatConfig(): GroupRepeatConfig {
  return {
    repeatWeekly: false,
    endMode: "weeks",
    weekCount: 4,
    endDate: "",
  };
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T12:00:00`);
  const to = new Date(`${toISO}T12:00:00`);
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/** Last weekly occurrence on or before endDate, starting from validFrom (same weekday). */
export function lastWeeklyOccurrenceOnOrBefore(validFrom: string, endDate: string): string {
  if (endDate < validFrom) return validFrom;
  const weeks = Math.floor(daysBetween(validFrom, endDate) / 7);
  return addDays(validFrom, weeks * 7);
}

export function computeSlotValidTo(validFrom: string, config: GroupRepeatConfig): string | null {
  if (!config.repeatWeekly) return validFrom;

  if (config.endMode === "weeks") {
    if (config.weekCount < 1) return validFrom;
    return addDays(validFrom, config.weekCount * 7 - 1);
  }

  if (!config.endDate) return null;
  if (config.endDate < validFrom) return validFrom;
  return lastWeeklyOccurrenceOnOrBefore(validFrom, config.endDate);
}

export function inferGroupRepeatConfig(validFrom: string, validTo: string | null): GroupRepeatConfig {
  if (validTo != null && validTo === validFrom) {
    return defaultGroupRepeatConfig();
  }

  if (validTo == null) {
    return {
      repeatWeekly: true,
      endMode: "date",
      weekCount: 4,
      endDate: "",
    };
  }

  const spanDays = daysBetween(validFrom, validTo);
  const weekCount = Math.max(2, Math.floor(spanDays / 7) + 1);
  // weeks mode stores valid_to = validFrom + N*7 - 1 (day before the next occurrence).
  const alignsToWeekCountEnd = spanDays >= 6 && (spanDays + 1) % 7 === 0;

  return {
    repeatWeekly: true,
    endMode: alignsToWeekCountEnd ? "weeks" : "date",
    weekCount,
    endDate: validTo,
  };
}

export function isRecurringGroupSlot(validFrom: string, validTo: string | null): boolean {
  return validTo == null || validTo > validFrom;
}
