import { useMemo } from "react";
import type { MemberRole } from "../types/organization";
import { formatClientName } from "../lib/utils";
import { useOrganization } from "../organization/OrganizationProvider";
import { useClientDirectory } from "./useClients";
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
  clientId4?: string;
  payerClientId?: string | null;
  priceId?: string | null;
  otherParticipants?: string | null;
  disciplineId: string | null;
  locationId: string | null;
  teacherMemberId: string | null;
  /** Billed amount (document total). */
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
      .map((lesson) => {
        const payerId = lesson.payerClientId ?? lesson.clientId1;
        const payerClient = clientMap[payerId];
        const payerDisplay = payerClient
          ? formatClientName(payerClient.lastName, payerClient.firstName)
          : lesson.clientDisplay;

        const participantIds = [
          lesson.clientId1,
          lesson.clientId2,
          lesson.clientId3,
          lesson.clientId4 ?? "",
        ].filter(Boolean);
        const otherNames = participantIds
          .filter((id) => id !== payerId)
          .map((id) => {
            const client = clientMap[id];
            return client ? formatClientName(client.lastName, client.firstName) : "";
          })
          .filter(Boolean);
        const otherParticipants = otherNames.length > 0 ? otherNames.join(", ") : null;

        return {
          id: lesson.id,
          date: lesson.date,
          timeStart: lesson.timeStart,
          timeEnd: lesson.timeEnd,
          clientDisplay: payerDisplay,
          clientId1: lesson.clientId1,
          clientId2: lesson.clientId2,
          clientId3: lesson.clientId3,
          clientId4: lesson.clientId4,
          payerClientId: lesson.payerClientId,
          priceId: lesson.priceId,
          otherParticipants,
          disciplineId: lesson.disciplineId ?? null,
          locationId: lesson.locationId ?? null,
          teacherMemberId: lesson.teacherMemberId ?? null,
          billedAmount: lesson.price,
          paidAmount: lesson.paidAmount,
          amount: includeAmount ? Math.max(lesson.price - lesson.paidAmount, 0) : undefined,
        };
      });
  }, [lessonsQuery.data, includeAmount, role, memberId, clientMap]);

  return {
    ...lessonsQuery,
    data,
    showAmount: includeAmount,
  };
}
