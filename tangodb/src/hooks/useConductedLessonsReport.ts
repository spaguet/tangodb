import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { ConductedLessonReportRow } from "../types";
import { mapConductedLessonReportRow } from "../lib/conductedLessonsReport";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const conductedLessonsReportQueryKey = ["conductedLessonsReport"] as const;

export interface ConductedLessonsReportParams {
  dateFrom: string;
  dateTo: string;
  disciplineIds: string[];
  enabled?: boolean;
}

export interface ConductedLessonsReportResult {
  success: boolean;
  rows: ConductedLessonReportRow[];
  error?: string;
}

export function useConductedLessonsReport(params: ConductedLessonsReportParams) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled =
    orgEnabled &&
    (params.enabled ?? true) &&
    Boolean(params.dateFrom && params.dateTo && params.disciplineIds.length > 0);

  return useQuery({
    queryKey: withOrgId([
      ...conductedLessonsReportQueryKey,
      params.dateFrom,
      params.dateTo,
      [...params.disciplineIds].sort().join(","),
    ]),
    enabled: queryEnabled,
    queryFn: async (): Promise<ConductedLessonsReportResult> => {
      const { data, error } = await supabase.rpc("get_conducted_group_lessons_report", {
        p_date_from: params.dateFrom,
        p_date_to: params.dateTo,
        p_discipline_ids: params.disciplineIds,
      });

      if (error) {
        return { success: false, rows: [], error: error.message };
      }

      const payload = data as { success?: boolean; rows?: Record<string, unknown>[]; error?: string };
      if (!payload?.success) {
        return {
          success: false,
          rows: [],
          error: payload?.error ?? "report.error.fetchFailed",
        };
      }

      return {
        success: true,
        rows: (payload.rows ?? []).map(mapConductedLessonReportRow),
      };
    },
    staleTime: 30 * 1000,
  });
}
