import { useMemo } from "react";
import { toISODateLocal } from "../lib/scheduleWeek";
import { usePersonalLessons } from "./usePersonalLessons";
import { usePersonalLessonsModuleEnabled } from "./useOrgModules";
import { useSchedule } from "./useSchedule";

export const scheduleMissingTeachersQueryKey = ["scheduleMissingTeachers"] as const;

export interface MissingTeacherPersonalEntry {
  kind: "personal";
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  clientDisplay: string;
  disciplineId: string | null;
  locationId: string | null;
}

export interface MissingTeacherGroupEntry {
  kind: "group";
  slotId: string;
  dayOfWeek: number;
  timeStart: string;
  timeEnd: string;
  groupName?: string;
  disciplineId: string | null;
  locationId: string | null;
  validFrom: string;
}

export type MissingTeacherEntry = MissingTeacherPersonalEntry | MissingTeacherGroupEntry;

export function useScheduleMissingTeachers(options?: { enabled?: boolean }) {
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const enabled = options?.enabled ?? true;

  const personalQuery = usePersonalLessons({
    excludeCancelled: true,
    enabled: personalLessonsEnabled && enabled,
  });

  const scheduleQuery = useSchedule({ enabled });

  const data = useMemo((): MissingTeacherEntry[] => {
    const today = toISODateLocal(new Date());
    const personal: MissingTeacherPersonalEntry[] = (personalQuery.data ?? [])
      .filter((lesson) => !lesson.teacherMemberId)
      .map((lesson) => ({
        kind: "personal" as const,
        id: lesson.id,
        date: lesson.date,
        timeStart: lesson.timeStart,
        timeEnd: lesson.timeEnd,
        clientDisplay: lesson.clientDisplay,
        disciplineId: lesson.disciplineId ?? null,
        locationId: lesson.locationId ?? null,
      }));

    const group: MissingTeacherGroupEntry[] = (scheduleQuery.data ?? [])
      .filter((slot) => {
        if (slot.teacherMemberId) return false;
        if (!slot.id) return false;
        if (slot.validTo && slot.validTo <= today) return false;
        return true;
      })
      .map((slot) => ({
        kind: "group" as const,
        slotId: slot.id!,
        dayOfWeek: slot.dayOfWeek,
        timeStart: slot.time,
        timeEnd: slot.timeEnd,
        groupName: slot.groupName,
        disciplineId: slot.disciplineId ?? null,
        locationId: slot.locationId ?? null,
        validFrom: slot.validFrom,
      }));

    return [...personal, ...group].sort((a, b) => {
      if (a.kind === "personal" && b.kind === "personal") {
        return a.date.localeCompare(b.date) || a.timeStart.localeCompare(b.timeStart);
      }
      if (a.kind === "group" && b.kind === "group") {
        return (
          a.dayOfWeek - b.dayOfWeek ||
          a.timeStart.localeCompare(b.timeStart) ||
          a.validFrom.localeCompare(b.validFrom)
        );
      }
      return a.kind === "personal" ? -1 : 1;
    });
  }, [personalQuery.data, scheduleQuery.data]);

  return {
    data,
    isLoading:
      (personalLessonsEnabled && personalQuery.isLoading) || scheduleQuery.isLoading,
    isError: personalQuery.isError || scheduleQuery.isError,
    error: personalQuery.error ?? scheduleQuery.error,
    personalLessonsEnabled,
  };
}
