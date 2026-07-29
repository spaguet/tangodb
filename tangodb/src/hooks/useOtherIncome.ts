import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { OtherIncome, PaymentMethod } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const otherIncomeQueryKey = ["otherIncome"] as const;

const mapOtherIncome = (row: Record<string, unknown>): OtherIncome => ({
  id: String(row.id),
  calendarEventId: String(row.calendar_event_id),
  amount: Number(row.amount) || 0,
  currency: String(row.currency ?? "RUB"),
  method: (row.method as PaymentMethod) || "cash",
  methodComment: row.method_comment != null ? String(row.method_comment) : null,
  createdAt: String(row.created_at ?? ""),
});

export interface OtherIncomeFilter {
  dateFrom?: string;
  dateTo?: string;
  enabled?: boolean;
}

function buildOtherIncomeQuery(filter?: OtherIncomeFilter) {
  let query = supabase
    .from("other_income")
    .select("id, calendar_event_id, amount, currency, method, method_comment, created_at")
    .order("created_at", { ascending: false });

  if (filter?.dateFrom) query = query.gte("created_at", `${filter.dateFrom}T00:00:00`);
  if (filter?.dateTo) query = query.lte("created_at", `${filter.dateTo}T23:59:59`);

  return query;
}

export function useOtherIncome(filter?: OtherIncomeFilter) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (filter?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...otherIncomeQueryKey, filter ?? {}]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await buildOtherIncomeQuery(filter);
      if (error) throw error;
      return (data ?? []).map((row) => mapOtherIncome(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useOtherIncomeTrend(endMonth: string, monthCount = 6) {
  const [y, m] = endMonth.split("-").map(Number);
  const start = new Date(y, m - 1 - (monthCount - 1), 1);
  const dateFrom = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const dateTo = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

  return useOtherIncome({ dateFrom, dateTo });
}
