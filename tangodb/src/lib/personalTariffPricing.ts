import { timeToMinutes } from "./scheduleWeek";

export type DurationWarningCode =
  | "legacy_no_duration"
  | "shorter"
  | "longer_not_multiple"
  | "longer_multiple";

export type DurationHardBlockCode =
  | "invalid_lesson_duration"
  | "tariff_not_found"
  | "invalid_tariff_duration"
  | "negative_billed"
  | "non_positive_billed_tariff_mode";

export interface DurationParts {
  hours: number;
  minutes: number;
}

export type LessonDurationTranslate = (
  key: string,
  params?: Record<string, string | number>
) => string;

const DURATION_HOURS_ONLY_KEY = "personalTariff.duration.hoursOnly";
const DURATION_MINUTES_ONLY_KEY = "personalTariff.duration.minutesOnly";
const DURATION_HOURS_AND_MINUTES_KEY = "personalTariff.duration.hoursAndMinutes";

/** Lesson slot length in minutes; ≤ 0 means not billable by duration. */
export function lessonDurationMinutes(timeStart: string, timeEnd: string): number {
  return timeToMinutes(timeEnd) - timeToMinutes(timeStart);
}

/** Split total minutes into hours and minutes for i18n formatting. */
export function durationParts(minutes: number): DurationParts {
  const total = Math.max(0, Math.floor(minutes));
  return {
    hours: Math.floor(total / 60),
    minutes: total % 60,
  };
}

/** Format lesson duration via i18n keys (no hardcoded locale strings here). */
export function formatLessonDuration(
  minutes: number,
  translate: LessonDurationTranslate
): string {
  const { hours, minutes: mins } = durationParts(minutes);

  if (hours > 0 && mins === 0) {
    return translate(DURATION_HOURS_ONLY_KEY, { hours });
  }
  if (hours === 0) {
    return translate(DURATION_MINUTES_ONLY_KEY, { minutes: mins });
  }
  return translate(DURATION_HOURS_AND_MINUTES_KEY, { hours, minutes: mins });
}

/** Exact tariff units for UI; never use to derive billed amount. */
export function tariffUnitsExact(lessonMinutes: number, tariffMinutes: number): number {
  if (tariffMinutes <= 0) return Number.NaN;
  return lessonMinutes / tariffMinutes;
}

/** Snapshot units (4 dp) for journal / UI only. */
export function tariffUnitsSnapshot(lessonMinutes: number, tariffMinutes: number): number {
  return roundHalfUp(tariffUnitsExact(lessonMinutes, tariffMinutes), 4);
}

/**
 * Billed amount from tariff: multiply-first in integer cents (matches SQL ROUND on numeric).
 * Legacy tariff without duration → flat tariff price.
 */
export function billedFromTariff(
  price: number,
  lessonMinutes: number,
  tariffMinutes: number | null | undefined
): number {
  if (tariffMinutes == null) {
    return roundMoney(price);
  }
  if (tariffMinutes <= 0 || lessonMinutes <= 0) {
    return Number.NaN;
  }

  const priceCents = moneyToCents(price);
  const billedCents = roundHalfUp((priceCents * lessonMinutes) / tariffMinutes, 0);
  return billedCents / 100;
}

/** Half-up to 2 decimal places for an already computed monetary value. */
export function roundMoney(value: number): number {
  return roundHalfUp(value, 2);
}

/** One warn code by priority §3.4; null when durations match or no warn applies. */
export function durationWarning(params: {
  lessonMinutes: number;
  tariffDurationMinutes: number | null | undefined;
}): DurationWarningCode | null {
  const { lessonMinutes, tariffDurationMinutes } = params;

  if (tariffDurationMinutes == null) {
    return "legacy_no_duration";
  }

  if (lessonMinutes < tariffDurationMinutes) {
    return "shorter";
  }

  if (lessonMinutes > tariffDurationMinutes) {
    return lessonMinutes % tariffDurationMinutes === 0
      ? "longer_multiple"
      : "longer_not_multiple";
  }

  return null;
}

/** Hard-block conditions from §3.4 (separate from warn codes). */
export function durationHardBlock(params: {
  lessonMinutes: number;
  tariffDurationMinutes?: number | null;
  tariffFound?: boolean;
  billed?: number;
  tariffPaymentMode?: boolean;
}): DurationHardBlockCode | null {
  if (params.lessonMinutes <= 0) {
    return "invalid_lesson_duration";
  }
  if (params.tariffFound === false) {
    return "tariff_not_found";
  }
  if (params.tariffDurationMinutes != null && params.tariffDurationMinutes <= 0) {
    return "invalid_tariff_duration";
  }
  if (params.billed != null && params.billed < 0) {
    return "negative_billed";
  }
  if (params.tariffPaymentMode && params.billed != null && params.billed <= 0) {
    return "non_positive_billed_tariff_mode";
  }
  return null;
}

/** i18n message for a single duration warn code (§3.4). */
export function translateDurationWarning(
  code: DurationWarningCode,
  translate: LessonDurationTranslate,
  tariffDurationMinutes: number | null | undefined,
  lessonMinutes: number
): string {
  const tariffDuration =
    tariffDurationMinutes != null ? formatLessonDuration(tariffDurationMinutes, translate) : "";
  const lessonDuration = formatLessonDuration(lessonMinutes, translate);
  switch (code) {
    case "legacy_no_duration":
      return translate("personalTariff.warn.legacyNoDuration");
    case "shorter":
      return translate("personalTariff.warn.shorter", { lessonDuration, tariffDuration });
    case "longer_not_multiple":
      return translate("personalTariff.warn.longerNotMultiple", { lessonDuration, tariffDuration });
    case "longer_multiple": {
      const multiple =
        tariffDurationMinutes != null && tariffDurationMinutes > 0
          ? Math.floor(lessonMinutes / tariffDurationMinutes)
          : 0;
      return translate("personalTariff.warn.longerMultiple", {
        multiple,
        tariffDuration,
        lessonDuration,
      });
    }
    default:
      return "";
  }
}

/** Equal split with remainder cents on index 0 (stage 2). */
export function splitBilledEqually(total: number, count: number): number[] {
  if (count <= 0) {
    throw new Error("splitBilledEqually: count must be positive");
  }
  if (count === 1) {
    return [roundMoney(total)];
  }

  const share = roundHalfUp(total / count, 2);
  const shares = Array.from({ length: count }, () => share);
  const remainder = roundMoney(total - share * count);
  if (remainder !== 0) {
    shares[0] = roundMoney(shares[0] + remainder);
  }
  return shares;
}

function moneyToCents(amount: number): number {
  return roundHalfUp(amount, 2) * 100;
}

/** PostgreSQL ROUND(numeric, scale): half away from zero. */
function roundHalfUp(value: number, decimals: number): number {
  if (!Number.isFinite(value)) {
    return Number.NaN;
  }
  const factor = 10 ** decimals;
  const scaled = value * factor;
  if (scaled >= 0) {
    return Math.floor(scaled + 0.5) / factor;
  }
  return Math.ceil(scaled - 0.5) / factor;
}
