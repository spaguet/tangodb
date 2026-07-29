import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { mapWaitlistEntry } from "../lib/groupCapacity";
import type { GroupSpotNotification, GroupWaitlistEntry, GroupWaitlistStatus } from "../types";
import { groupCapacityQueryKey } from "./useGroupCapacity";
import { scheduleGroupsQueryKey } from "./useScheduleGroups";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const groupWaitlistQueryKey = ["group_waitlist"] as const;
export const groupSpotNotificationsQueryKey = ["group_spot_notifications"] as const;

export function useGroupWaitlist(classId?: string | null, options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true) && Boolean(classId);

  return useQuery({
    queryKey: withOrgId([...groupWaitlistQueryKey, classId ?? ""]),
    enabled: queryEnabled,
    queryFn: async (): Promise<GroupWaitlistEntry[]> => {
      const { data, error } = await supabase
        .from("group_waitlist_entries")
        .select("*")
        .eq("class_id", classId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => mapWaitlistEntry(row as Record<string, unknown>));
    },
    staleTime: 15 * 1000,
  });
}

export function useGroupSpotNotifications(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(groupSpotNotificationsQueryKey),
    enabled: queryEnabled,
    queryFn: async (): Promise<GroupSpotNotification[]> => {
      const { data, error } = await supabase
        .from("group_spot_notifications")
        .select("id, class_id, waitlist_entry_id, client_id, created_at")
        .is("dismissed_at", null)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        id: row.id as string,
        classId: row.class_id as string,
        waitlistEntryId: row.waitlist_entry_id as string,
        clientId: row.client_id as string,
        createdAt: String(row.created_at),
      }));
    },
    staleTime: 15 * 1000,
  });
}

function invalidateGroupCapacityQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: groupCapacityQueryKey });
  void queryClient.invalidateQueries({ queryKey: scheduleGroupsQueryKey });
  void queryClient.invalidateQueries({ queryKey: groupWaitlistQueryKey });
  void queryClient.invalidateQueries({ queryKey: groupSpotNotificationsQueryKey });
}

export function useUpdateClassMaxCapacity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { classId: string; maxCapacity: number | null }) => {
      const { data, error } = await supabase.rpc("update_class_max_capacity", {
        p_class_id: input.classId,
        p_max_capacity: input.maxCapacity,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "groupCapacity.error.updateFailed" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateGroupCapacityQueries(queryClient);
    },
  });
}

export function useAddGroupWaitlistEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { classId: string; clientId: string; comment?: string }) => {
      const { data, error } = await supabase.rpc("add_group_waitlist_entry", {
        p_class_id: input.classId,
        p_client_id: input.clientId,
        p_comment: input.comment ?? null,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string; id?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "groupWaitlist.error.addFailed" };
      }
      return { success: true as const, id: result.id };
    },
    onSuccess: (result) => {
      if (result.success) invalidateGroupCapacityQueries(queryClient);
    },
  });
}

export function useUpdateGroupWaitlistStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      entryId: string;
      status: GroupWaitlistStatus;
      comment?: string;
    }) => {
      const { data, error } = await supabase.rpc("update_group_waitlist_status", {
        p_entry_id: input.entryId,
        p_new_status: input.status,
        p_comment: input.comment ?? null,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "groupWaitlist.error.updateFailed" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) invalidateGroupCapacityQueries(queryClient);
    },
  });
}

export function useDismissGroupSpotNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { data, error } = await supabase.rpc("dismiss_group_spot_notification", {
        p_notification_id: notificationId,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "groupWaitlist.error.dismissFailed" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: groupSpotNotificationsQueryKey });
      }
    },
  });
}
