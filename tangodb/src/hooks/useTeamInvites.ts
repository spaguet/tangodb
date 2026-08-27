import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { inviteMember } from "../lib/edgeFunctions";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import { normalizeTeacherScope } from "../lib/teacherScope";
import type { MemberRole, MemberMeta, TeacherScope } from "../types/organization";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { teamMembersFullQueryKey, teamMembersQueryKey } from "./useTeamMembers";

export interface PendingInvite {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role: MemberRole;
  scope: TeacherScope;
  meta: MemberMeta;
  expires_at: string;
  created_at: string;
}

export const teamInvitesQueryKey = ["organization-invites"] as const;

export function useTeamInvites() {
  const { enabled, organizationId, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(teamInvitesQueryKey),
    enabled: enabled && !!organizationId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("organization_invites_team_v")
        .select("id, email, first_name, last_name, role, scope, meta, expires_at, created_at")
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id as string,
        email: row.email as string,
        first_name: (row.first_name as string | null) ?? null,
        last_name: (row.last_name as string | null) ?? null,
        role: row.role as MemberRole,
        scope: normalizeTeacherScope(row.scope),
        meta:
          row.meta != null && typeof row.meta === "object" && !Array.isArray(row.meta)
            ? (row.meta as unknown as MemberMeta)
            : {},
        expires_at: row.expires_at as string,
        created_at: row.created_at as string,
      })) satisfies PendingInvite[];
    },
    staleTime: 30 * 1000,
  });
}

export function useTeamMutations() {
  const queryClient = useQueryClient();
  const { organizationId, withOrgId } = useOrgQueryScope();

  const invalidate = () => {
    if (organizationId) {
      queryClient.invalidateQueries({ queryKey: withOrgId(teamMembersQueryKey) });
      queryClient.invalidateQueries({ queryKey: withOrgId(teamMembersFullQueryKey) });
      queryClient.invalidateQueries({ queryKey: withOrgId(teamInvitesQueryKey) });
      queryClient.invalidateQueries({ queryKey: withOrgId(["organization-audit"]) });
    }
  };

  const invite = useMutation({
    mutationFn: (params: {
      email: string;
      firstName: string;
      lastName: string;
      role: MemberRole;
      scope?: TeacherScope;
      meta?: MemberMeta;
    }) => inviteMember(params),
    onSuccess: invalidate,
  });

  const revokeInvite = useMutation({
    mutationFn: async (inviteId: string) => {
      const { error } = await supabase.rpc("revoke_organization_invite", {
        p_invite_id: inviteId,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const updateMember = useMutation({
    mutationFn: async (params: {
      memberId: string;
      role?: MemberRole;
      scope?: TeacherScope;
      meta?: MemberMeta;
      isActive?: boolean;
      displayName?: string;
      firstName?: string;
      lastName?: string;
      patronymic?: string;
      contactEmail?: string;
      phone?: string;
      telegram?: string;
      profileNotes?: string;
    }) => {
      const { error } = await supabase.rpc("update_team_member", {
        p_member_id: params.memberId,
        p_role: params.role ?? null,
        p_scope: params.scope == null ? null : asJson(params.scope),
        p_meta: params.meta == null ? null : asJson(params.meta),
        p_is_active: params.isActive ?? null,
        p_display_name: params.displayName ?? null,
        p_first_name: params.firstName ?? null,
        p_last_name: params.lastName ?? null,
        p_patronymic: params.patronymic ?? null,
        p_contact_email: params.contactEmail ?? null,
        p_phone: params.phone ?? null,
        p_telegram: params.telegram ?? null,
        p_profile_notes: params.profileNotes ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { invite, revokeInvite, updateMember };
}
