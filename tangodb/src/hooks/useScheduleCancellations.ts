import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { normalizeTime, toISODateLocal } from "../lib/scheduleWeek";
import { useOrgQueryScope } from "./useOrgQueryScope";
import type { MemberRole } from "../types/organization";

export const scheduleCancellationsQueryKey = ["scheduleCancellations"] as const;

export interface ScheduleCancellationEntry {
  id: string;
  slotId: string | null;
  teacherMemberId: string | null;
  disciplineId: string | null;
  locationId: string | null;
  groupName: string | null;
  date: string;
  timeStart: string;
  timeEnd: string;
  cancelledAt: string;
}

const mapRow = (row: Record<string, unknown>): ScheduleCancellationEntry => ({
  id: String(row.id),
  slotId: row.slot_id != null ? String(row.slot_id) : null,
  teacherMemberId: row.teacher_member_id != null ? String(row.teacher_member_id) : null,
  disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
  locationId: row.location_id != null ? String(row.location_id) : null,
  groupName: row.group_name != null ? String(row.group_name) : null,
  date: String(row.occurrence_date).slice(0, 10),
  timeStart: normalizeTime(String(row.time)),
  timeEnd: normalizeTime(String(row.time_end)),
  cancelledAt: String(row.cancelled_at),
});

export function useScheduleCancellations(options?: {
  enabled?: boolean;
  limit?: number;
  role?: MemberRole | null;
  memberId?: string | null;
}) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const todayISO = toISODateLocal(new Date());
  const limit = options?.limit ?? 30;
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  const query = useQuery({
    queryKey: withOrgId([...scheduleCancellationsQueryKey, todayISO, limit]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_occurrence_cancellations")
        .select("*")
        .gte("occurrence_date", todayISO)
        .order("occurrence_date")
        .order("time")
        .limit(limit);

      if (error) throw error;
      return (data ?? []).map(mapRow);
    },
    staleTime: 60 * 1000,
  });

  const data = useMemo(() => {
    const rows = query.data ?? [];
    if (options?.role !== "teacher" || !options.memberId) return rows;
    return rows.filter((row) => row.teacherMemberId === options.memberId);
  }, [query.data, options?.role, options?.memberId]);

  return {
    ...query,
    data,
  };
}
