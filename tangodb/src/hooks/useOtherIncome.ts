import { useQuery } from "@tanstack/react-query";
import { applyCreatedAtUtcRange, orgCreatedAtUtcRange } from "../lib/orgFinanceDate";
import { fetchAllPostgrestRows } from "../lib/postgrestRange";
import { supabase } from "../lib/supabase";
import type { OtherIncome, PaymentMethod } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
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

function buildOtherIncomeQuery(filter?: OtherIncomeFilter, timezone = "UTC") {
  const query = supabase
    .from("other_income")
    .select("id, calendar_event_id, amount, currency, method, method_comment, created_at")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  return applyCreatedAtUtcRange(query, orgCreatedAtUtcRange(filter ?? {}, timezone));
}

export function useOtherIncome(filter?: OtherIncomeFilter) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { settings } = useOrganization();
  const timezone = settings?.timezone ?? "UTC";
  const queryEnabled = orgEnabled && (filter?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...otherIncomeQueryKey, filter ?? {}, timezone]),
    enabled: queryEnabled,
    queryFn: async () => {
      const data = await fetchAllPostgrestRows((from, to) =>
        buildOtherIncomeQuery(filter, timezone).range(from, to)
      );
      return data.map((row) => mapOtherIncome(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}
