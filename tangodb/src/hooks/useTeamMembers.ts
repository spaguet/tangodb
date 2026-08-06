import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { t, type I18nKey } from "../lib/i18n";
import type { MemberRole, MemberMeta, TeacherScope } from "../types/organization";
import { normalizeTeacherScope } from "../lib/teacherScope";
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

export function useTeamMembers(options?: { enabled?: boolean }) {
  const { enabled, organizationId, withOrgId } = useOrgQueryScope();
  const queryEnabled = enabled && !!organizationId && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(teamMembersQueryKey),
    enabled: queryEnabled,
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
        scope: normalizeTeacherScope(row.scope),
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

const ROLE_KEYS: Record<MemberRole, I18nKey> = {
  owner: "team.role.owner",
  director: "team.role.director",
  admin: "team.role.admin",
  teacher: "team.role.teacher",
  accountant: "team.role.accountant",
};

export function memberRoleLabel(
  role: MemberRole,
  meta?: MemberMeta,
  locale?: string | null
): string {
  if (role === "admin" && meta?.restricted_admin) {
    return t(locale, "team.role.reception");
  }
  const key = ROLE_KEYS[role];
  return key ? t(locale, key) : role;
}

export function memberDisplayName(
  member: Pick<TeamMemberRow, "first_name" | "last_name" | "patronymic">
): string | null {
  const parts = [member.last_name, member.first_name, member.patronymic].filter(Boolean);
  if (parts.length > 0) return parts.join(" ");
  return null;
}

export function memberListLabel(
  member: Pick<TeamMemberRow, "first_name" | "last_name" | "patronymic" | "role" | "meta">,
  locale?: string | null
): string {
  return memberDisplayName(member) ?? memberRoleLabel(member.role, member.meta, locale);
}
