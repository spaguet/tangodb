import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const firstDayChecklistExistsQueryKey = ["firstDayChecklist", "exists"] as const;

type FirstDayChecklistTable =
  | "locations"
  | "disciplines"
  | "prices"
  | "clients"
  | "schedule_slots"
  | "subscriptions"
  | "personal_lessons"
  | "attendance";

async function tableHasAnyRow(table: FirstDayChecklistTable): Promise<boolean> {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .limit(1);
  if (error) throw error;
  return (count ?? 0) > 0;
}

function useFirstDayChecklistTableExists(
  stepId: string,
  table: FirstDayChecklistTable,
  checklistActive: boolean,
  extraEnabled = true
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...firstDayChecklistExistsQueryKey, stepId]),
    enabled: orgEnabled && checklistActive && extraEnabled,
    queryFn: () => tableHasAnyRow(table),
  });
}

export function useFirstDayChecklistExists(options: {
  checklistActive: boolean;
  personalLessonsModule: boolean;
  trackSaleStep: boolean;
}) {
  const { checklistActive, personalLessonsModule, trackSaleStep } = options;

  const locationQuery = useFirstDayChecklistTableExists("location", "locations", checklistActive);
  const disciplineQuery = useFirstDayChecklistTableExists("discipline", "disciplines", checklistActive);
  const pricesQuery = useFirstDayChecklistTableExists("prices", "prices", checklistActive);
  const clientQuery = useFirstDayChecklistTableExists("client", "clients", checklistActive);
  const scheduleQuery = useFirstDayChecklistTableExists("schedule", "schedule_slots", checklistActive);
  const subscriptionsQuery = useFirstDayChecklistTableExists(
    "subscriptions",
    "subscriptions",
    checklistActive,
    trackSaleStep
  );
  const personalLessonsQuery = useFirstDayChecklistTableExists(
    "personalLessons",
    "personal_lessons",
    checklistActive,
    personalLessonsModule
  );
  const attendanceQuery = useFirstDayChecklistTableExists("attendance", "attendance", checklistActive);

  return {
    hasLocation: locationQuery.data === true,
    hasDiscipline: disciplineQuery.data === true,
    hasPrices: pricesQuery.data === true,
    hasClient: clientQuery.data === true,
    hasSchedule: scheduleQuery.data === true,
    hasSubscription: subscriptionsQuery.data === true,
    hasPersonalLesson: personalLessonsQuery.data === true,
    hasAttendance: attendanceQuery.data === true,
  };
}
