import { useMemo } from "react";
import type { MemberRole } from "../types/organization";
import { formatClientName } from "../lib/utils";
import { useOrganization } from "../organization/OrganizationProvider";
import { useClientDirectory } from "./useClients";
import { usePersonalLessons } from "./usePersonalLessons";
import { usePersonalLessonsModuleEnabled } from "./useOrgModules";
import { usePersonalLessonChargeBalances } from "./usePersonalLessonCharges";

export const scheduleDebtorsQueryKey = ["scheduleDebtors"] as const;

export interface ScheduleDebtorEntry {
  id: string;
  personalLessonId: string;
  chargeId?: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  clientDisplay: string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  clientId4?: string;
  payerClientId?: string | null;
  priceId?: string | null;
  otherParticipants?: string | null;
  disciplineId: string | null;
  locationId: string | null;
  teacherMemberId: string | null;
  /** Billed amount for this charge. */
  billedAmount: number;
  paidAmount: number;
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
  const { data: clientMap = {} } = useClientDirectory();
  const teacherDebtorList = role === "teacher";
  const enabled =
    personalLessonsEnabled &&
    (options?.enabled ?? true) &&
    (!teacherDebtorList || Boolean(memberId));

  const lessonsQuery = usePersonalLessons({
    paidFilter: "no",
    excludeCancelled: true,
    // Occupancy view marks foreign lessons as paid='no'; without this filter a teacher
    // paginates every location lesson and the debtors block never finishes loading.
    teacherMemberId: teacherDebtorList ? memberId ?? undefined : undefined,
    enabled,
  });

  const filteredLessons = useMemo(() => {
    return (lessonsQuery.data ?? []).filter((lesson) => {
      if (role !== "teacher") return true;
      return Boolean(memberId && lesson.teacherMemberId === memberId);
    });
  }, [lessonsQuery.data, role, memberId]);

  const lessonIds = useMemo(() => filteredLessons.map((l) => l.id), [filteredLessons]);

  const chargesQuery = usePersonalLessonChargeBalances(lessonIds, {
    enabled:
      !teacherDebtorList &&
      personalLessonsEnabled &&
      (options?.enabled ?? true) &&
      lessonIds.length > 0,
  });

  const lessonById = useMemo(
    () => Object.fromEntries(filteredLessons.map((l) => [l.id, l])),
    [filteredLessons]
  );

  const data = useMemo((): ScheduleDebtorEntry[] => {
    if (teacherDebtorList) {
      return filteredLessons.map((lesson) => {
        const participantIds = [
          lesson.clientId1,
          lesson.clientId2,
          lesson.clientId3,
          lesson.clientId4 ?? "",
        ].filter(Boolean);
        const payerId = lesson.clientId1;
        const otherNames = participantIds
          .filter((id) => id !== payerId)
          .map((id) => {
            const client = clientMap[id];
            return client ? formatClientName(client.lastName, client.firstName) : "";
          })
          .filter(Boolean);
        const debtorClient = clientMap[payerId];
        const debtorDisplay = debtorClient
          ? formatClientName(debtorClient.lastName, debtorClient.firstName)
          : lesson.clientDisplay;

        return {
          id: lesson.id,
          personalLessonId: lesson.id,
          date: lesson.date,
          timeStart: lesson.timeStart,
          timeEnd: lesson.timeEnd,
          clientDisplay: debtorDisplay,
          clientId1: lesson.clientId1,
          clientId2: lesson.clientId2,
          clientId3: lesson.clientId3,
          clientId4: lesson.clientId4,
          payerClientId: payerId,
          priceId: lesson.priceId,
          otherParticipants: otherNames.length > 0 ? otherNames.join(", ") : null,
          disciplineId: lesson.disciplineId ?? null,
          locationId: lesson.locationId ?? null,
          teacherMemberId: lesson.teacherMemberId ?? null,
          billedAmount: 0,
          paidAmount: 0,
        };
      });
    }

    const charges = chargesQuery.data ?? [];
    const entries: ScheduleDebtorEntry[] = [];

    for (const charge of charges) {
      if (charge.remainingAmount <= 0) continue;
      const lesson = lessonById[charge.personalLessonId];
      if (!lesson) continue;

      const debtorClient = clientMap[charge.clientId];
      const debtorDisplay = debtorClient
        ? formatClientName(debtorClient.lastName, debtorClient.firstName)
        : lesson.clientDisplay;

      const participantIds = [
        lesson.clientId1,
        lesson.clientId2,
        lesson.clientId3,
        lesson.clientId4 ?? "",
      ].filter(Boolean);
      const otherNames = participantIds
        .filter((id) => id !== charge.clientId)
        .map((id) => {
          const client = clientMap[id];
          return client ? formatClientName(client.lastName, client.firstName) : "";
        })
        .filter(Boolean);

      entries.push({
        id: charge.id,
        personalLessonId: lesson.id,
        chargeId: charge.id,
        date: lesson.date,
        timeStart: lesson.timeStart,
        timeEnd: lesson.timeEnd,
        clientDisplay: debtorDisplay,
        clientId1: lesson.clientId1,
        clientId2: lesson.clientId2,
        clientId3: lesson.clientId3,
        clientId4: lesson.clientId4,
        payerClientId: charge.clientId,
        priceId: lesson.priceId,
        otherParticipants: otherNames.length > 0 ? otherNames.join(", ") : null,
        disciplineId: lesson.disciplineId ?? null,
        locationId: lesson.locationId ?? null,
        teacherMemberId: lesson.teacherMemberId ?? null,
        billedAmount: charge.billedAmount,
        paidAmount: charge.paidAmount,
        amount: includeAmount ? charge.remainingAmount : undefined,
      });
    }

    return entries;
  }, [
    teacherDebtorList,
    filteredLessons,
    chargesQuery.data,
    lessonById,
    clientMap,
    includeAmount,
  ]);

  return {
    ...lessonsQuery,
    isLoading: lessonsQuery.isLoading || (!teacherDebtorList && chargesQuery.isLoading),
    isError: lessonsQuery.isError || (!teacherDebtorList && chargesQuery.isError),
    error: lessonsQuery.error ?? (teacherDebtorList ? null : chargesQuery.error),
    data,
    showAmount: includeAmount,
  };
}
