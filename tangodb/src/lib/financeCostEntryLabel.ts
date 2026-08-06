import type { FinanceCostEntry } from "../hooks/useVenueCosts";
import type { I18nKey } from "./i18n/keys";

function joinParts(parts: Array<string | null | undefined>, separator = " · "): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join(separator);
}

function formatTimeRange(timeStart?: string | null, timeEnd?: string | null): string | null {
  const start = timeStart?.trim();
  if (!start) return null;
  const end = timeEnd?.trim();
  return end ? `${start}–${end}` : start;
}

function formatPeriod(from?: string | null, to?: string | null): string | null {
  if (!from || !to) return null;
  const fromDate = from.slice(0, 10);
  const toDate = to.slice(0, 10);
  if (fromDate === toDate) return fromDate;
  return `${fromDate}–${toDate}`;
}

export function formatFinanceCostEntryTitle(
  entry: FinanceCostEntry,
  t: (key: I18nKey, vars?: Record<string, string | number>) => string
): string {
  const kind = entry.detailKind;
  const title = entry.title?.trim();
  const discipline = entry.disciplineName?.trim();
  const location = entry.locationName?.trim();
  const timeRange = formatTimeRange(entry.timeStart, entry.timeEnd);
  const attendees =
    entry.attendeeCount != null
      ? t("venueCosts.finance.attendeeCount", { count: entry.attendeeCount })
      : null;
  const period = formatPeriod(entry.periodFrom, entry.periodTo);

  if (kind === "venue_lesson_personal") {
    return joinParts([
      t("venueCosts.finance.lessonPersonal"),
      title || t("venueCosts.finance.lessonClientUnknown"),
      discipline,
      timeRange,
      location,
    ]);
  }

  if (kind === "venue_lesson_group") {
    return joinParts([
      t("venueCosts.finance.lessonGroup"),
      title || discipline || t("venueCosts.finance.lessonGroupFallback"),
      timeRange,
      attendees,
      location,
    ]);
  }

  if (kind === "venue_fixed_period") {
    return joinParts([t("venueCosts.finance.fixedPeriod"), location, period]);
  }

  if (kind === "teacher_deduction") {
    return joinParts([
      t("venueCosts.finance.teacherExpenseRow"),
      title || discipline,
      timeRange,
      location,
    ]);
  }

  if (kind === "venue_adjustment" && entry.reason?.trim()) {
    return entry.reason.trim();
  }

  return entry.description?.trim() || title || t("venueCosts.finance.autoRow");
}
