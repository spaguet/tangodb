import { useEffect, useMemo, useRef, useState } from "react";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  FREEBUSY_INVOKE_TIMEOUT_MS,
  WEEKLY_RECURRENCE_SLOT_CAP,
} from "../lib/dateRecurrenceLimits";
import {
  fetchTeacherGoogleFreebusy,
  type GoogleFreebusyInterval,
} from "../lib/googleCalendarApi";
import { lessonOverlapsBusyIntervals } from "../lib/googleCalendarFreebusy";

export interface FreebusyLessonSlot {
  date: string;
  timeStart: string;
  timeEnd: string;
}

export interface UseGoogleCalendarFreebusyOptions {
  teacherMemberId: string | null | undefined;
  slots: FreebusyLessonSlot[];
  enabled?: boolean;
}

export function useGoogleCalendarFreebusy({
  teacherMemberId,
  slots,
  enabled = true,
}: UseGoogleCalendarFreebusyOptions) {
  const { settings } = useOrganization();
  const timeZone = settings?.timezone ?? "UTC";
  const [busyByKey, setBusyByKey] = useState<Map<string, GoogleFreebusyInterval[]>>(new Map());
  const [isChecking, setIsChecking] = useState(false);
  const requestIdRef = useRef(0);

  const normalizedSlots = useMemo(
    () =>
      slots
        .filter(
          (slot) =>
            slot.date &&
            slot.timeStart &&
            slot.timeEnd &&
            slot.timeEnd > slot.timeStart
        )
        .slice(0, WEEKLY_RECURRENCE_SLOT_CAP),
    [slots]
  );

  const slotKey = (slot: FreebusyLessonSlot) =>
    `${slot.date}|${slot.timeStart}|${slot.timeEnd}`;

  useEffect(() => {
    if (!enabled || !teacherMemberId || normalizedSlots.length === 0) {
      setBusyByKey(new Map());
      setIsChecking(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const abortController = new AbortController();
    const deadlineTimer = window.setTimeout(() => {
      abortController.abort();
    }, FREEBUSY_INVOKE_TIMEOUT_MS * normalizedSlots.length + 5_000);

    const debounceTimer = window.setTimeout(() => {
      void (async () => {
        setIsChecking(true);
        const next = new Map<string, GoogleFreebusyInterval[]>();

        try {
          for (const slot of normalizedSlots) {
            if (requestId !== requestIdRef.current || abortController.signal.aborted) return;

            const result = await fetchTeacherGoogleFreebusy(
              {
                organizationMemberId: teacherMemberId,
                date: slot.date,
                timeStart: slot.timeStart,
                timeEnd: slot.timeEnd,
              },
              { signal: abortController.signal }
            );
            if (requestId !== requestIdRef.current) return;
            if (result.configured && result.busy.length > 0) {
              next.set(slotKey(slot), result.busy);
            }
          }
        } catch {
          if (requestId !== requestIdRef.current) return;
        } finally {
          window.clearTimeout(deadlineTimer);
          if (requestId === requestIdRef.current) {
            setBusyByKey(next);
            setIsChecking(false);
          }
        }
      })();
    }, 400);

    return () => {
      window.clearTimeout(debounceTimer);
      window.clearTimeout(deadlineTimer);
      requestIdRef.current += 1;
      abortController.abort();
    };
  }, [enabled, teacherMemberId, normalizedSlots, timeZone]);

  const overlappingSlots = useMemo(() => {
    const keys = new Set<string>();
    for (const slot of normalizedSlots) {
      const busy = busyByKey.get(slotKey(slot));
      if (!busy?.length) continue;
      if (lessonOverlapsBusyIntervals(slot.date, slot.timeStart, slot.timeEnd, timeZone, busy)) {
        keys.add(slotKey(slot));
      }
    }
    return keys;
  }, [normalizedSlots, busyByKey, timeZone]);

  const hasOverlap = overlappingSlots.size > 0;

  return {
    hasOverlap,
    overlappingSlots,
    isChecking,
    slotKey,
    slotsCapped: slots.length > WEEKLY_RECURRENCE_SLOT_CAP,
  };
}
