import { useMemo } from "react";
import { addDays, toISODateLocal } from "../lib/scheduleWeek";
import type { MemberRole } from "../types/organization";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePersonalLessons } from "./usePersonalLessons";

/** How far beyond the selected week to load unpaid personal lessons. */
const DEBTORS_HORIZON_DAYS = 56;

export const scheduleDebtorsQueryKey = ["scheduleDebtors"] as const;

export interface ScheduleDebtorEntry {
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  clientDisplay: string;
  disciplineId: string | null;
  locationId: string | null;
  teacherMemberId: string | null;
  /** Only for owner/director — never shown to teacher/admin in UI. */
  amount?: number;
}

export function canShowScheduleDebtAmount(role: MemberRole | null): boolean {
  return role === "owner" || role === "director";
}

export function useScheduleDebtors(
  weekStart: Date,
  weekEnd: Date,
  options?: { enabled?: boolean }
) {
  const { role } = useOrganization();
  const weekStartISO = toISODateLocal(weekStart);
  const rangeEndISO = addDays(toISODateLocal(weekEnd), DEBTORS_HORIZON_DAYS);
  const includeAmount = canShowScheduleDebtAmount(role);

  const lessonsQuery = usePersonalLessons({
    dateRange: { start: weekStartISO, end: rangeEndISO },
    enabled: options?.enabled ?? true,
  });

  const data = useMemo((): ScheduleDebtorEntry[] => {
    return (lessonsQuery.data ?? [])
      .filter((lesson) => lesson.paid === "no")
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) || a.timeStart.localeCompare(b.timeStart)
      )
      .map((lesson) => ({
        id: lesson.id,
        date: lesson.date,
        timeStart: lesson.timeStart,
        timeEnd: lesson.timeEnd,
        clientDisplay: lesson.clientDisplay,
        disciplineId: lesson.disciplineId ?? null,
        locationId: lesson.locationId ?? null,
        teacherMemberId: lesson.teacherMemberId ?? null,
        amount: includeAmount ? lesson.price : undefined,
      }));
  }, [lessonsQuery.data, includeAmount]);

  return {
    ...lessonsQuery,
    data,
    showAmount: includeAmount,
  };
}
