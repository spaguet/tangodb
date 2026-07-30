import { supabase } from "../supabase";
import { OFFLINE_MARK_SCOPE } from "./constants";
import type { AttendanceMarkStatus, OfflineAttendanceOperation } from "./types";

export type SyncAttendanceResult =
  | { outcome: "applied"; newLessonsLeft?: number; alreadyApplied?: boolean }
  | { outcome: "conflict"; serverOldStatus: AttendanceMarkStatus | null; serverLessonsLeft?: number }
  | { outcome: "failed"; error: string };

export async function syncOfflineAttendanceOp(
  op: OfflineAttendanceOperation
): Promise<SyncAttendanceResult> {
  const { data, error } = await supabase.rpc("sync_offline_mark_attendance", {
    p_date: op.dateStr,
    p_sub_id: op.subId,
    p_new_status: op.newStatus,
    p_schedule_group_id: op.scheduleGroupId,
    p_discipline_id: op.disciplineId,
    p_expected_old_status: op.expectedOldStatus,
    p_idempotency_key: op.id,
  });

  if (error) {
    return { outcome: "failed", error: error.message };
  }

  const result = data as {
    success?: boolean;
    error?: string;
    error_code?: string;
    newLessonsLeft?: number;
    already_applied?: boolean;
    server_old_status?: string | null;
    server_lessons_left?: number;
  } | null;

  if (!result) {
    return { outcome: "failed", error: "Empty response" };
  }

  if (result.error_code === "state_conflict" || result.error === "state_conflict") {
    return {
      outcome: "conflict",
      serverOldStatus: (result.server_old_status as AttendanceMarkStatus | null) ?? null,
      serverLessonsLeft: result.server_lessons_left,
    };
  }

  if (!result.success) {
    return { outcome: "failed", error: result.error ?? "Sync failed" };
  }

  return {
    outcome: "applied",
    newLessonsLeft: result.newLessonsLeft,
    alreadyApplied: result.already_applied ?? false,
  };
}

export function fingerprintOfflineOp(op: OfflineAttendanceOperation): string {
  return [
    OFFLINE_MARK_SCOPE,
    op.dateStr,
    op.subId,
    op.scheduleGroupId,
    op.expectedOldStatus ?? "null",
    op.newStatus,
  ].join("|");
}
