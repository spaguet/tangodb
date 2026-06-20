import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { MemberRole, MemberMeta, TeacherScope } from "../types/organization";
import { useOrgQueryScope } from "./useOrgQueryScope";

export interface TeamMemberRow {
  id: string;
  user_id: string;
  role: MemberRole;
  scope: TeacherScope;
  meta: MemberMeta;
  display_name: string | null;
  is_active: boolean;
  joined_at: string | null;
}

export const teamMembersQueryKey = ["organization-team"] as const;

export function useTeamMembers() {
  const { enabled, organizationId, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(teamMembersQueryKey),
    enabled: enabled && !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_members")
        .select("id, user_id, role, scope, meta, display_name, is_active, joined_at")
        .eq("organization_id", organizationId!)
        .order("joined_at", { ascending: true });

      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id as string,
        user_id: row.user_id as string,
        role: row.role as MemberRole,
        scope: row.scope as TeacherScope,
        meta: (row.meta as MemberMeta) ?? {},
        display_name: (row.display_name as string | null) ?? null,
        is_active: row.is_active as boolean,
        joined_at: (row.joined_at as string | null) ?? null,
      })) satisfies TeamMemberRow[];
    },
    staleTime: 60 * 1000,
  });
}

const ROLE_LABELS: Record<MemberRole, string> = {
  owner: "Владелец",
  director: "Руководитель",
  admin: "Администратор",
  teacher: "Преподаватель",
  accountant: "Бухгалтер",
};

export function memberRoleLabel(role: MemberRole, meta?: MemberMeta): string {
  if (role === "admin" && meta?.restricted_admin) return "Кассир";
  return ROLE_LABELS[role] ?? role;
}
