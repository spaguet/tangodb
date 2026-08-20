import type { Payment } from "../types";
import { formatLessonDuration, lessonDurationMinutes } from "./personalTariffPricing";
import type { TranslateFn } from "./utils";

export function personalPaymentHasTariff(
  payment: Pick<Payment, "priceId" | "tariffLabel" | "tariffDurationMinutes">
): boolean {
  return Boolean(
    payment.priceId || payment.tariffLabel?.trim() || payment.tariffDurationMinutes != null
  );
}

export function resolvePersonalPaymentLessonMinutes(
  payment: Pick<Payment, "lessonDurationMinutes">,
  lesson?: { timeStart: string; timeEnd: string } | null
): number | null {
  if (payment.lessonDurationMinutes != null && payment.lessonDurationMinutes > 0) {
    return payment.lessonDurationMinutes;
  }
  if (lesson?.timeStart && lesson.timeEnd) {
    const minutes = lessonDurationMinutes(lesson.timeStart, lesson.timeEnd);
    return minutes > 0 ? minutes : null;
  }
  return null;
}

export function formatPersonalPaymentLessonDuration(
  payment: Pick<Payment, "lessonDurationMinutes">,
  lesson: { timeStart: string; timeEnd: string } | null | undefined,
  translate: TranslateFn
): string {
  const minutes = resolvePersonalPaymentLessonMinutes(payment, lesson);
  if (minutes == null) return "—";
  return formatLessonDuration(minutes, translate);
}

export function resolvePersonalPaymentTariffLabel(
  payment: Pick<Payment, "priceId" | "tariffLabel" | "tariffDurationMinutes">,
  translate: TranslateFn
): string {
  if (!personalPaymentHasTariff(payment)) {
    return translate("personalTariff.journal.noTariff");
  }
  return payment.tariffLabel?.trim() || translate("personalTariff.journal.tariffFallback");
}

export function formatTariffUnitsMultiplier(units: number): string {
  const normalized = Number(units);
  if (!Number.isFinite(normalized)) return "";
  const text = Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(4).replace(/\.?0+$/, "");
  return `×${text}`;
}

export function resolvePersonalPaymentUnitsLabel(
  payment: Pick<Payment, "priceId" | "tariffLabel" | "tariffDurationMinutes" | "tariffUnits">
): string | null {
  if (!personalPaymentHasTariff(payment) || payment.tariffUnits == null) return null;
  return formatTariffUnitsMultiplier(payment.tariffUnits);
}
