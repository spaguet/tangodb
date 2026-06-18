import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { inviteMember } from "../lib/edgeFunctions";
import type { MemberRole, TeacherScope } from "../types/organization";
import { EMPTY_TEACHER_SCOPE } from "../lib/permissions";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { teamMembersQueryKey } from "./useTeamMembers";

export interface PendingInvite {
  id: string;
  email: string;
  role: MemberRole;
  scope: TeacherScope;
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
        .from("organization_invites")
        .select("id, email, role, scope, expires_at, created_at")
        .is("accepted_at", null)
        .is("revoked_at", null)
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false });

      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id as string,
        email: row.email as string,
        role: row.role as MemberRole,
        scope: (row.scope as TeacherScope) ?? EMPTY_TEACHER_SCOPE,
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
      queryClient.invalidateQueries({ queryKey: withOrgId(teamInvitesQueryKey) });
      queryClient.invalidateQueries({ queryKey: withOrgId(["organization-audit"]) });
    }
  };

  const invite = useMutation({
    mutationFn: inviteMember,
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
      isActive?: boolean;
      displayName?: string;
    }) => {
      const { error } = await supabase.rpc("update_team_member", {
        p_member_id: params.memberId,
        p_role: params.role ?? null,
        p_scope: params.scope ?? null,
        p_is_active: params.isActive ?? null,
        p_display_name: params.displayName ?? null,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return { invite, revokeInvite, updateMember };
}
