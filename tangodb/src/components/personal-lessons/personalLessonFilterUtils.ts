import { addDays, getWeekRange, toISODateLocal } from "../../lib/scheduleWeek";
import { currentYearMonth } from "../../lib/utils";
import type { UsePersonalLessonsOptions } from "../../hooks/usePersonalLessons";

export type PersonalLessonPeriodMode = "week" | "month" | "range";

export type PersonalLessonPaidFilter = "all" | "yes" | "no";

export type PersonalLessonAttendanceFilter = "all" | "unmarked" | "present" | "absent" | "excused";

export interface PersonalLessonFilterState {
  periodMode: PersonalLessonPeriodMode;
  weekStart: string;
  yearMonth: string;
  rangeStart: string;
  rangeEnd: string;
  locationId: string;
  disciplineId: string;
  teacherMemberId: string;
  clientId: string;
  paidFilter: PersonalLessonPaidFilter;
  attendanceFilter: PersonalLessonAttendanceFilter;
  search: string;
}

export function defaultPersonalLessonFilters(): PersonalLessonFilterState {
  const { weekStart } = getWeekRange(new Date());
  const today = toISODateLocal(new Date());
  return {
    periodMode: "month",
    weekStart: toISODateLocal(weekStart),
    yearMonth: currentYearMonth(),
    rangeStart: today,
    rangeEnd: addDays(today, 30),
    locationId: "",
    disciplineId: "",
    teacherMemberId: "",
    clientId: "",
    paidFilter: "all",
    attendanceFilter: "all",
    search: "",
  };
}

export function filtersToQueryOptions(filters: PersonalLessonFilterState): UsePersonalLessonsOptions {
  const options: UsePersonalLessonsOptions = {};

  if (filters.locationId) options.locationId = filters.locationId;
  if (filters.disciplineId) options.disciplineId = filters.disciplineId;
  if (filters.teacherMemberId) options.teacherMemberId = filters.teacherMemberId;
  if (filters.clientId) options.clientId = filters.clientId;
  if (filters.paidFilter === "yes" || filters.paidFilter === "no") {
    options.paidFilter = filters.paidFilter;
  }
  if (filters.attendanceFilter !== "all") {
    options.attendanceStatus = filters.attendanceFilter;
  }

  if (filters.periodMode === "month") {
    options.yearMonth = filters.yearMonth;
  } else if (filters.periodMode === "week") {
    options.dateRange = {
      start: filters.weekStart,
      end: addDays(filters.weekStart, 6),
    };
  } else if (filters.rangeStart && filters.rangeEnd) {
    options.dateRange = {
      start: filters.rangeStart,
      end: filters.rangeEnd,
    };
  }

  return options;
}

import type { TranslateFn } from "../../lib/utils";

export function personalLessonTypeLabel(type: string, t: TranslateFn): string {
  switch (type) {
    case "pair":
      return t("common.formatPair");
    case "trio":
      return t("common.formatTrio");
    case "quad":
      return t("common.formatQuad");
    default:
      return t("common.formatSolo");
  }
}
