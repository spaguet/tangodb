import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";

export interface AuditLogRow {
  id: string;
  table_name: string;
  operation: string;
  row_id: string;
  changed_at: string;
  changed_by: string | null;
}

export const orgAuditQueryKey = ["organization-audit"] as const;

const TEAM_TABLES = new Set([
  "organization_members",
  "organization_invites",
  "organization_settings",
]);

export function useOrgAuditLog(limit = 30) {
  const { enabled, organizationId, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...orgAuditQueryKey, limit]),
    enabled: enabled && !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, table_name, operation, row_id, changed_at, changed_by")
        .in("table_name", [...TEAM_TABLES])
        .order("changed_at", { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data ?? []) as AuditLogRow[];
    },
    staleTime: 60 * 1000,
  });
}

export function auditTableLabel(table: string): string {
  switch (table) {
    case "organization_members":
      return "Команда";
    case "organization_invites":
      return "Приглашения";
    case "organization_settings":
      return "Настройки";
    default:
      return table;
  }
}
