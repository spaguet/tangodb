import { useMemo } from "react";
import type { MemberRole } from "../types/organization";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePersonalLessons } from "./usePersonalLessons";
import { usePersonalLessonsModuleEnabled } from "./useOrgModules";

export const scheduleDebtorsQueryKey = ["scheduleDebtors"] as const;

export interface ScheduleDebtorEntry {
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  clientDisplay: string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  disciplineId: string | null;
  locationId: string | null;
  teacherMemberId: string | null;
  /** Only for owner/director — never shown to teacher/admin in UI. */
  amount?: number;
}

export function canShowScheduleDebtAmount(role: MemberRole | null): boolean {
  return role === "owner" || role === "director";
}

export function useScheduleDebtors(options?: { enabled?: boolean }) {
  const { role, memberId } = useOrganization();
  const includeAmount = canShowScheduleDebtAmount(role);
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();

  const lessonsQuery = usePersonalLessons({
    paidFilter: "no",
    enabled: personalLessonsEnabled && (options?.enabled ?? true),
  });

  const data = useMemo((): ScheduleDebtorEntry[] => {
    return (lessonsQuery.data ?? [])
      .filter((lesson) => {
        if (role !== "teacher") return true;
        return Boolean(memberId && lesson.teacherMemberId === memberId);
      })
      .map((lesson) => ({
        id: lesson.id,
        date: lesson.date,
        timeStart: lesson.timeStart,
        timeEnd: lesson.timeEnd,
        clientDisplay: lesson.clientDisplay,
        clientId1: lesson.clientId1,
        clientId2: lesson.clientId2,
        clientId3: lesson.clientId3,
        disciplineId: lesson.disciplineId ?? null,
        locationId: lesson.locationId ?? null,
        teacherMemberId: lesson.teacherMemberId ?? null,
        amount: includeAmount ? Math.max(lesson.price - lesson.paidAmount, 0) : undefined,
      }));
  }, [lessonsQuery.data, includeAmount, role, memberId]);

  return {
    ...lessonsQuery,
    data,
    showAmount: includeAmount,
  };
}
