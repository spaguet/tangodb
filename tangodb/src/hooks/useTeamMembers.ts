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
  first_name: string | null;
  last_name: string | null;
  patronymic: string | null;
  contact_email: string | null;
  phone: string | null;
  telegram: string | null;
  profile_notes: string | null;
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
        .select(
          "id, user_id, role, scope, meta, display_name, first_name, last_name, patronymic, contact_email, phone, telegram, profile_notes, is_active, joined_at"
        )
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
        first_name: (row.first_name as string | null) ?? null,
        last_name: (row.last_name as string | null) ?? null,
        patronymic: (row.patronymic as string | null) ?? null,
        contact_email: (row.contact_email as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        telegram: (row.telegram as string | null) ?? null,
        profile_notes: (row.profile_notes as string | null) ?? null,
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

export function memberDisplayName(
  member: Pick<TeamMemberRow, "first_name" | "last_name" | "patronymic">
): string | null {
  const parts = [member.last_name, member.first_name, member.patronymic].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return null;
}

export function memberListLabel(
  member: Pick<TeamMemberRow, "first_name" | "last_name" | "patronymic" | "role" | "meta">
): string {
  return memberDisplayName(member) ?? memberRoleLabel(member.role, member.meta);
}
