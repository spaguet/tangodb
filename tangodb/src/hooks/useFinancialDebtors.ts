import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { DebtorEntry } from "../lib/financeReports";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const financialDebtorsQueryKey = ["financialDebtors"] as const;

const FINANCIAL_DEBTORS_SELECT =
  "organization_id, id, kind, client_display, contact, detail, amount, lessons_left, lessons_total, lesson_date";

function mapFinancialDebtor(row: Record<string, unknown>): DebtorEntry {
  const kind = row.kind === "personal" ? "personal" : "subscription";
  return {
    id: String(row.id),
    clientDisplay: String(row.client_display ?? ""),
    contact: String(row.contact ?? "—"),
    kind,
    detail: String(row.detail ?? ""),
    amount: Number(row.amount) || 0,
    lessonsLeft: row.lessons_left != null ? Number(row.lessons_left) : null,
    lessonsTotal: row.lessons_total != null ? Number(row.lessons_total) : null,
    lessonDate: row.lesson_date != null ? String(row.lesson_date) : null,
  };
}

export function useFinancialDebtors(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...financialDebtorsQueryKey]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_debtors_v")
        .select(FINANCIAL_DEBTORS_SELECT)
        .order("amount", { ascending: false })
        .order("client_display", { ascending: true });

      if (error) throw error;

      return (data ?? []).map((row) => mapFinancialDebtor(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}
