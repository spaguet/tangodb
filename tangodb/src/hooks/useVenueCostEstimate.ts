import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  buildManualVenueCostLessons,
  buildScheduleVenueCostLessons,
  buildVenueCostEstimate,
  type VenueCostEstimateFilters,
  type VenueCostEstimateResult,
} from "../lib/venueCostEstimate";
import type { VenueCostVersionSnapshot } from "../lib/venueCostRules";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { usePersonalLessons } from "./usePersonalLessons";
import { useSchedule } from "./useSchedule";

export type VenueCostEstimateSource = "manual" | "schedule";

export interface UseVenueCostEstimateOptions {
  snapshot: VenueCostVersionSnapshot | null;
  periodStart: string;
  periodEnd: string;
  source: VenueCostEstimateSource;
  filters?: VenueCostEstimateFilters;
  manual?: {
    groupLessonCount: number;
    personalLessonCount: number;
    groupAttendeeCount: number;
    teacherMemberId: string | null;
    disciplineId: string | null;
    locationId: string | null;
  };
  defaultGroupAttendees?: number;
  enabled?: boolean;
}

export function useVenueCostEstimateScheduleContext(
  periodStart: string,
  periodEnd: string,
  enabled = true
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && enabled && Boolean(periodStart && periodEnd && periodStart <= periodEnd);

  const scheduleQuery = useSchedule({ enabled: queryEnabled });
  const personalQuery = usePersonalLessons({
    dateRange: { start: periodStart, end: periodEnd },
    excludeCancelled: true,
    enabled: queryEnabled,
  });

  const cancellationsQuery = useQuery({
    queryKey: withOrgId(["venue-cost-estimate", "cancellations", periodStart, periodEnd]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_occurrence_cancellations")
        .select("slot_id, occurrence_date")
        .gte("occurrence_date", periodStart)
        .lte("occurrence_date", periodEnd);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const slotId = row.slot_id != null ? String(row.slot_id) : "";
        const date = String(row.occurrence_date).slice(0, 10);
        return `${slotId}:${date}`;
      });
    },
    staleTime: 60_000,
  });

  const closuresQuery = useQuery({
    queryKey: withOrgId(["venue-cost-estimate", "closures", periodStart, periodEnd]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lesson_occurrence_closures")
        .select("schedule_slot_id, occurrence_date, confirmed_attendee_count, occurrence_kind, status")
        .eq("occurrence_kind", "group")
        .eq("status", "closed")
        .gte("occurrence_date", periodStart)
        .lte("occurrence_date", periodEnd);
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of data ?? []) {
        const slotId = row.schedule_slot_id != null ? String(row.schedule_slot_id) : "";
        const date = String(row.occurrence_date).slice(0, 10);
        if (!slotId) continue;
        map.set(`${slotId}:${date}`, Number(row.confirmed_attendee_count) || 0);
      }
      return map;
    },
    staleTime: 60_000,
  });

  return {
    scheduleSlots: scheduleQuery.data ?? [],
    personalLessons: personalQuery.data ?? [],
    cancelledKeys: useMemo(() => new Set(cancellationsQuery.data ?? []), [cancellationsQuery.data]),
    closureAttendeesByKey: closuresQuery.data ?? new Map<string, number>(),
    isLoading:
      scheduleQuery.isLoading ||
      personalQuery.isLoading ||
      cancellationsQuery.isLoading ||
      closuresQuery.isLoading,
    isError:
      scheduleQuery.isError ||
      personalQuery.isError ||
      cancellationsQuery.isError ||
      closuresQuery.isError,
  };
}

export function useVenueCostEstimate(options: UseVenueCostEstimateOptions): {
  result: VenueCostEstimateResult | null;
  lessonCount: number;
  isLoading: boolean;
} {
  const {
    snapshot,
    periodStart,
    periodEnd,
    source,
    filters = {},
    manual,
    defaultGroupAttendees = 4,
    enabled = true,
  } = options;

  const scheduleContext = useVenueCostEstimateScheduleContext(
    periodStart,
    periodEnd,
    enabled && source === "schedule"
  );

  const lessons = useMemo(() => {
    if (!enabled || !snapshot) return [];
    if (source === "manual" && manual) {
      return buildManualVenueCostLessons({
        periodStart,
        groupLessonCount: manual.groupLessonCount,
        personalLessonCount: manual.personalLessonCount,
        groupAttendeeCount: manual.groupAttendeeCount,
        teacherMemberId: manual.teacherMemberId,
        disciplineId: manual.disciplineId,
        locationId: manual.locationId,
      });
    }
    if (source === "schedule") {
      return buildScheduleVenueCostLessons({
        periodStart,
        periodEnd,
        slots: scheduleContext.scheduleSlots,
        personalLessons: scheduleContext.personalLessons,
        cancelledKeys: scheduleContext.cancelledKeys,
        defaultGroupAttendees,
        closureAttendeesByKey: scheduleContext.closureAttendeesByKey,
      });
    }
    return [];
  }, [
    enabled,
    snapshot,
    source,
    periodStart,
    periodEnd,
    manual,
    defaultGroupAttendees,
    scheduleContext,
  ]);

  const result = useMemo(() => {
    if (!enabled || !snapshot || periodStart > periodEnd) return null;
    return buildVenueCostEstimate(snapshot, periodStart, periodEnd, lessons, filters);
  }, [enabled, snapshot, periodStart, periodEnd, lessons, filters]);

  const filteredLessonCount = useMemo(() => {
    if (!result) return lessons.length;
    if (snapshot?.mode === "fixed_period") return 0;
    return result.lessonLines.length;
  }, [result, lessons.length, snapshot?.mode]);

  return {
    result,
    lessonCount: filteredLessonCount,
    isLoading: source === "schedule" && scheduleContext.isLoading,
  };
}
