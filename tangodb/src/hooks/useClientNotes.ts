import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { ClientNote } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { memberDisplayName, useTeamMembers } from "./useTeamMembers";

export const clientNotesQueryKey = ["clientNotes"] as const;

const NOTES_SELECT = "id, client_id, author_member_id, body, created_at";

const mapClientNote = (
  row: Record<string, unknown>,
  authorLabel: string,
  authorRole: string
): ClientNote => ({
  id: row.id as string,
  clientId: row.client_id as string,
  authorMemberId: row.author_member_id as string,
  authorDisplayName: authorLabel,
  authorRole,
  body: row.body as string,
  createdAt: String(row.created_at ?? ""),
});

export function clientNotesListQueryKey(clientId: string) {
  return [...clientNotesQueryKey, clientId] as const;
}

export function useClientNotes(clientId: string | null) {
  const { enabled, withOrgId } = useOrgQueryScope();
  const { data: teamMembers = [] } = useTeamMembers();

  return useQuery({
    queryKey: withOrgId([
      ...clientNotesListQueryKey(clientId ?? ""),
      teamMembers.length,
    ]),
    enabled: enabled && Boolean(clientId),
    queryFn: async () => {
      const authorByMemberId = new Map<string, { label: string; role: string }>();
      for (const member of teamMembers) {
        authorByMemberId.set(member.id, {
          label: memberDisplayName(member),
          role: member.role,
        });
      }

      const { data, error } = await supabase
        .from("client_notes")
        .select(NOTES_SELECT)
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => {
        const record = row as unknown as Record<string, unknown>;
        const authorMemberId = record.author_member_id as string;
        const author = authorByMemberId.get(authorMemberId);
        return mapClientNote(
          record,
          author?.label ?? "common.employee",
          author?.role ?? ""
        );
      });
    },
    staleTime: 30 * 1000,
  });
}

export function useAddClientNote() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();
  const { memberId } = useOrganization();

  return useMutation({
    mutationFn: async ({ clientId, body }: { clientId: string; body: string }) => {
      if (!organizationId || !memberId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const trimmed = body.trim();
      if (!trimmed) {
        return { success: false as const, error: "hooks.error.noteEmpty" };
      }

      const { error } = await supabase.from("client_notes").insert({
        organization_id: organizationId,
        client_id: clientId,
        author_member_id: memberId,
        body: trimmed,
      });

      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: clientNotesListQueryKey(variables.clientId) });
      }
    },
  });
}

export function useDeleteClientNote() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ noteId, clientId }: { noteId: string; clientId: string }) => {
      const { error } = await supabase.from("client_notes").delete().eq("id", noteId);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const, clientId };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: clientNotesListQueryKey(result.clientId) });
      }
    },
  });
}
