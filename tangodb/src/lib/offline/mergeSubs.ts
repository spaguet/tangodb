import type { SubForDate } from "../../types";
import type { AttendanceMarkStatus, OfflineAttendanceOperation } from "./types";

function computeAttendanceDeltas(
  oldStatus: AttendanceMarkStatus | null,
  newStatus: AttendanceMarkStatus
): { lessonDelta: number; freezeDelta: number } {
  let lessonDelta = 0;
  let freezeDelta = 0;

  if (oldStatus === "present" || oldStatus === "absent") lessonDelta += 1;
  if (oldStatus === "freeze") freezeDelta -= 1;

  if (newStatus === "present" || newStatus === "absent") lessonDelta -= 1;
  if (newStatus === "freeze") freezeDelta += 1;

  if (
    (oldStatus === "present" || oldStatus === "absent") &&
    (newStatus === "present" || newStatus === "absent")
  ) {
    lessonDelta = 0;
  }

  return { lessonDelta, freezeDelta };
}

/** Overlay pending offline marks on snapshot subs — does not change confirmed server balance */
export function mergeSubsWithOfflineOps(
  baseSubs: SubForDate[],
  operations: OfflineAttendanceOperation[],
  dateStr: string,
  scheduleGroupId: string
): Array<SubForDate & { offlinePending?: boolean; projectedLessonsLeft?: number }> {
  const relevant = operations.filter(
    (op) =>
      op.dateStr === dateStr &&
      op.scheduleGroupId === scheduleGroupId &&
      (op.status === "pending" || op.status === "syncing" || op.status === "failed")
  );

  if (relevant.length === 0) {
    return baseSubs.map((s) => ({ ...s }));
  }

  const bySub = new Map<string, OfflineAttendanceOperation[]>();
  for (const op of relevant) {
    const list = bySub.get(op.subId) ?? [];
    list.push(op);
    bySub.set(op.subId, list);
  }

  return baseSubs.map((sub) => {
    const ops = bySub.get(sub.subId);
    if (!ops?.length) return { ...sub };

    let projectedStatus = sub.currentStatus;
    let projectedLessonsLeft = sub.lessonsLeft;
    let projectedFreezeUsed = sub.freezeUsed;

    for (const op of ops.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      const { lessonDelta, freezeDelta } = computeAttendanceDeltas(
        projectedStatus,
        op.newStatus
      );
      projectedLessonsLeft += lessonDelta;
      projectedFreezeUsed += freezeDelta;
      projectedStatus = op.newStatus;
    }

    return {
      ...sub,
      currentStatus: projectedStatus,
      offlinePending: true,
      projectedLessonsLeft,
      lessonsLeft: sub.lessonsLeft,
      freezeUsed: sub.freezeUsed,
    };
  });
}

export function attendanceStatusLabelKey(status: AttendanceMarkStatus | null): string {
  if (status === "present") return "attendance.status.present";
  if (status === "absent") return "attendance.status.absent";
  if (status === "freeze") return "attendance.status.freeze";
  if (status === "excused") return "attendance.status.excused";
  return "common.notMarked";
}
