import type { SubForDate } from "../../types";

export type OfflineOpStatus =
  | "pending"
  | "syncing"
  | "applied"
  | "conflict"
  | "failed"
  | "cancelled";

export type AttendanceMarkStatus = "present" | "absent" | "freeze" | "excused";

export interface SnapshotScheduleDate {
  date: string;
  time: string;
  timeEnd?: string;
  slotId?: string;
  disciplineId?: string | null;
  locationId?: string | null;
  scheduleGroupId?: string | null;
  teacherMemberId?: string | null;
  label?: string;
}

export interface SnapshotLocation {
  id: string;
  name: string;
}

export interface ShiftSnapshot {
  schemaVersion: number;
  userId: string;
  organizationId: string;
  syncedAt: string;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  locations: SnapshotLocation[];
  scheduleDates: SnapshotScheduleDate[];
  /** date → subs roster for that date (confirmed server state at sync time) */
  subsByDate: Record<string, SubForDate[]>;
}

export interface OfflineAttendanceOperation {
  id: string;
  kind: "group_attendance";
  status: OfflineOpStatus;
  createdAt: string;
  deviceCreatedAt: string;
  dateStr: string;
  subId: string;
  scheduleGroupId: string;
  disciplineId: string | null;
  expectedOldStatus: AttendanceMarkStatus | null;
  newStatus: AttendanceMarkStatus;
  /** Confirmed lessons_left from snapshot when op was created */
  snapshotLessonsLeft: number;
  snapshotFreezeUsed: number;
  clientDisplay: string;
  lastError?: string;
  serverOldStatus?: AttendanceMarkStatus | null;
  serverLessonsLeft?: number;
  appliedAt?: string;
  conflictResolvedAt?: string;
  conflictResolution?: "apply_offline" | "keep_server" | "cancelled";
}

export interface OfflinePaymentDraft {
  id: string;
  createdAt: string;
  kind: "personal_lesson" | "single_visit" | "subscription";
  reminderLabel: string;
  targetRef: string;
  dateStr?: string;
}

export interface OfflineQueue {
  schemaVersion: number;
  userId: string;
  organizationId: string;
  operations: OfflineAttendanceOperation[];
  paymentDrafts: OfflinePaymentDraft[];
  updatedAt: string;
}

export interface OfflineNamespace {
  userId: string;
  organizationId: string;
}

export function offlineNamespaceKey(ns: OfflineNamespace): string {
  return `${ns.userId}:${ns.organizationId}`;
}
