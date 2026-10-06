import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAllPostgrestRows } from "../lib/postgrestRange";
import { supabase } from "../lib/supabase";
import { formatClientName } from "../lib/utils";
import { useClientDirectory } from "./useClients";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { invalidateOrgScopedQueries } from "../lib/orgQueryFilter";
import type { Client } from "../types";

export type RosterAttendanceStatus = "present" | "absent" | "excused";

export type GroupRosterMember = {
  clientId: string;
  displayName: string;
};

export type RosterAttendeeForDate = GroupRosterMember & {
  currentStatus: RosterAttendanceStatus | null;
};

export const groupRosterQueryKey = ["schedule_group_roster"] as const;
export const rosterAttendanceQueryKey = ["roster_attendance"] as const;

type RosterRow = {
  schedule_group_id: string;
  client_id: string;
};

type RosterAttendanceRow = {
  date: string;
  schedule_group_id: string;
  client_id: string;
  attendance_status: RosterAttendanceStatus;
};

function mapRosterMembers(
  roster: RosterRow[],
  scheduleGroupId: string,
  clients: Client[]
): GroupRosterMember[] {
  const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
  return roster
    .filter((r) => r.schedule_group_id === scheduleGroupId)
    .map((r) => {
      const client = clientMap[r.client_id];
      return {
        clientId: r.client_id,
        displayName: client
          ? formatClientName(client.lastName, client.firstName)
          : r.client_id,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, "ru"));
}

export function useGroupRosterForLesson(
  scheduleGroupId: string | null | undefined,
  dateStr: string | undefined,
  yearMonth: string | undefined
) {
  const { enabled, organizationId, withOrgId } = useOrgQueryScope();
  const clientsQuery = useClientDirectory();

  const rosterQuery = useQuery({
    queryKey: withOrgId([...groupRosterQueryKey, scheduleGroupId ?? ""]),
    enabled: Boolean(enabled && organizationId && scheduleGroupId),
    queryFn: async () => {
      const rows = await fetchAllPostgrestRows<RosterRow>((from, to) =>
        supabase
          .from("schedule_group_roster")
          .select("schedule_group_id, client_id")
          .eq("schedule_group_id", scheduleGroupId!)
          .range(from, to)
      );
      return rows;
    },
  });

  const attendanceQuery = useQuery({
    queryKey: withOrgId([...rosterAttendanceQueryKey, yearMonth ?? "", scheduleGroupId ?? ""]),
    enabled: Boolean(enabled && organizationId && scheduleGroupId && yearMonth),
    queryFn: async () => {
      const [y, m] = yearMonth!.split("-").map(Number);
      const start = `${y}-${String(m).padStart(2, "0")}-01`;
      const lastDay = new Date(y, m, 0).getDate();
      const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
      const rows = await fetchAllPostgrestRows((from, to) =>
        supabase
          .from("roster_attendance")
          .select("date, schedule_group_id, client_id, attendance_status")
          .eq("schedule_group_id", scheduleGroupId!)
          .gte("date", start)
          .lte("date", end)
          .range(from, to)
      );
      return rows as RosterAttendanceRow[];
    },
  });

  const rosterMembers = useMemo(
    () =>
      scheduleGroupId
        ? mapRosterMembers(rosterQuery.data ?? [], scheduleGroupId, clientsQuery.data ?? [])
        : [],
    [scheduleGroupId, rosterQuery.data, clientsQuery.data]
  );

  const rosterAttendeesForDate = useMemo((): RosterAttendeeForDate[] => {
    if (!dateStr || !scheduleGroupId) return [];
    const statusByClient = new Map<string, RosterAttendanceStatus>();
    for (const row of attendanceQuery.data ?? []) {
      if (row.date.slice(0, 10) !== dateStr || row.schedule_group_id !== scheduleGroupId) continue;
      statusByClient.set(row.client_id, row.attendance_status);
    }
    return rosterMembers.map((m) => ({
      ...m,
      currentStatus: statusByClient.get(m.clientId) ?? null,
    }));
  }, [dateStr, scheduleGroupId, attendanceQuery.data, rosterMembers]);

  return {
    rosterMembers,
    rosterAttendeesForDate,
    isLoading: rosterQuery.isLoading || attendanceQuery.isLoading || clientsQuery.isLoading,
    isError: rosterQuery.isError || attendanceQuery.isError || clientsQuery.isError,
    error: rosterQuery.error ?? attendanceQuery.error ?? clientsQuery.error,
  };
}

export function useAddGroupRosterClient() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (vars: { scheduleGroupId: string; clientId: string }) => {
      const { data, error } = await supabase.rpc("add_group_roster_client", {
        p_schedule_group_id: vars.scheduleGroupId,
        p_client_id: vars.clientId,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "common.saveFailed" };
      }
      return { success: true as const };
    },
    onSuccess: () => {
      invalidateOrgScopedQueries(queryClient, groupRosterQueryKey, organizationId);
    },
  });
}

export function useRemoveGroupRosterClient() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (vars: { scheduleGroupId: string; clientId: string }) => {
      const { data, error } = await supabase.rpc("remove_group_roster_client", {
        p_schedule_group_id: vars.scheduleGroupId,
        p_client_id: vars.clientId,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "common.saveFailed" };
      }
      return { success: true as const };
    },
    onSuccess: () => {
      invalidateOrgScopedQueries(queryClient, groupRosterQueryKey, organizationId);
    },
  });
}

export function useMarkRosterAttendance() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (vars: {
      dateStr: string;
      scheduleGroupId: string;
      clientId: string;
      status: RosterAttendanceStatus;
    }) => {
      const { data, error } = await supabase.rpc("mark_roster_attendance", {
        p_date: vars.dateStr,
        p_schedule_group_id: vars.scheduleGroupId,
        p_client_id: vars.clientId,
        p_new_status: vars.status,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "common.saveFailed" };
      }
      return { success: true as const };
    },
    onSuccess: () => {
      invalidateOrgScopedQueries(queryClient, rosterAttendanceQueryKey, organizationId);
    },
  });
}
