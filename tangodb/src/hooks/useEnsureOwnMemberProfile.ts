import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "../organization/OrganizationProvider";
import { supabase } from "../lib/supabase";
import { teamMembersQueryKey } from "./useTeamMembers";

export function useEnsureOwnMemberProfile() {
  const queryClient = useQueryClient();
  const { organizationId, memberId, orgLoading } = useOrganization();
  const syncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!organizationId || !memberId || orgLoading) return;
    if (syncedRef.current === memberId) return;
    syncedRef.current = memberId;

    void supabase.rpc("ensure_own_member_profile").then(({ error }) => {
      if (error) {
        syncedRef.current = null;
        return;
      }
      void queryClient.invalidateQueries({
        queryKey: [...teamMembersQueryKey, organizationId],
      });
    });
  }, [organizationId, memberId, orgLoading, queryClient]);
}
