import { useQuery } from "@tanstack/react-query";
import { t, type I18nKey } from "../lib/i18n";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";

export interface AuditLogRow {
  id: string;
  table_name: string;
  operation: string;
  row_id: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_at: string;
  changed_by: string | null;
}

export const orgAuditQueryKey = ["organization-audit"] as const;

const AUDIT_TABLE_KEYS: Record<string, I18nKey> = {
  organization_members: "team.auditTable.members",
  organization_invites: "team.auditTable.invites",
  organization_settings: "team.auditTable.settings",
  clients: "team.auditTable.clients",
  subscriptions: "team.auditTable.subscriptions",
  payments: "team.auditTable.payments",
  personal_lessons: "team.auditTable.personalLessons",
  attendance: "team.auditTable.attendance",
  single_visits: "team.auditTable.singleVisits",
  expenses: "team.auditTable.expenses",
  client_notes: "team.auditTable.clientNotes",
};

export function getDayBounds(date: Date): { start: string; end: string } {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function useOrgAuditLog(options?: {
  date?: Date;
  limit?: number;
  enabled?: boolean;
}) {
  const { enabled: orgEnabled, organizationId, withOrgId } = useOrgQueryScope();
  const date = options?.date;
  const limit = options?.limit ?? 200;
  const enabled = orgEnabled && !!organizationId && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([
      ...orgAuditQueryKey,
      date ? date.toISOString().slice(0, 10) : "all",
      limit,
    ]),
    enabled,
    queryFn: async () => {
      let query = supabase
        .from("audit_log")
        .select("id, table_name, operation, row_id, old_data, new_data, changed_at, changed_by")
        .order("changed_at", { ascending: false })
        .limit(limit);

      if (date) {
        const { start, end } = getDayBounds(date);
        query = query.gte("changed_at", start).lte("changed_at", end);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data ?? []) as AuditLogRow[];
    },
    staleTime: 60 * 1000,
  });
}

export function auditTableLabel(table: string, locale?: string | null): string {
  const key = AUDIT_TABLE_KEYS[table];
  return key ? t(locale, key) : table;
}
