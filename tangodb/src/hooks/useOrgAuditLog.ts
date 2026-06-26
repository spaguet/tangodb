import { useQuery } from "@tanstack/react-query";
import { t, type I18nKey } from "../lib/i18n";
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

const AUDIT_TABLE_KEYS: Record<string, I18nKey> = {
  organization_members: "team.auditTable.members",
  organization_invites: "team.auditTable.invites",
  organization_settings: "team.auditTable.settings",
};

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

export function auditTableLabel(table: string, locale?: string | null): string {
  const key = AUDIT_TABLE_KEYS[table];
  return key ? t(locale, key) : table;
}
