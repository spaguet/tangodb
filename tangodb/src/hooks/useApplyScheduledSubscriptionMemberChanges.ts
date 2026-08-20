import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrganization } from "../organization/OrganizationProvider";
import { reportClientError } from "../lib/reportClientError";
import { applyScheduledSubscriptionMemberChanges } from "../lib/subscriptionMembers";
import { attendanceQueryKey } from "./useAttendance";
import { groupCapacityQueryKey } from "./useGroupCapacity";
import { subscriptionMemberChangesQueryKey } from "./useSubscriptionMemberChanges";
import { subscriptionsQueryKey } from "./useSubscriptions";

/** Once per org entry: apply due partner replacements. Not from subscription queryFn (M5). */
export function useApplyScheduledSubscriptionMemberChanges() {
  const queryClient = useQueryClient();
  const { organizationId, orgLoading } = useOrganization();
  const appliedForOrgRef = useRef<string | null>(null);

  useEffect(() => {
    if (!organizationId || orgLoading) return;
    if (appliedForOrgRef.current === organizationId) return;
    appliedForOrgRef.current = organizationId;

    void applyScheduledSubscriptionMemberChanges(organizationId).then((result) => {
      if (result.success === false) {
        appliedForOrgRef.current = null;
        reportClientError(new Error(result.error), {
          area: "subscriptions",
          action: "apply_scheduled_member_changes",
          meta: { organizationId },
        });
        return;
      }
      void queryClient.invalidateQueries({ queryKey: subscriptionsQueryKey });
      void queryClient.invalidateQueries({ queryKey: subscriptionMemberChangesQueryKey });
      void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
      void queryClient.invalidateQueries({ queryKey: groupCapacityQueryKey });
    });
  }, [organizationId, orgLoading, queryClient]);
}
