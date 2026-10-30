import { LocalNotifications } from "@capacitor/local-notifications";
import type { ShiftSnapshot } from "../offline/types";
import { stableNotificationId, wallClockInTimeZoneToDate } from "./timezone";
import { readLessonRemindersEnabled } from "./preferences";

const CHANNEL_ID = "tangodb-lessons";
const LEAD_MINUTES = 15;

export type LocalReminderCopy = {
  title: string;
  body: string;
};

async function ensureAndroidChannel(): Promise<void> {
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: "TangoDB lessons",
      description: "Upcoming lesson reminders",
      importance: 3,
      visibility: 1,
    });
  } catch {
    // iOS / unsupported
  }
}

export async function cancelAllLocalLessonReminders(): Promise<void> {
  try {
    const pending = await LocalNotifications.getPending();
    const list = pending.notifications ?? [];
    if (list.length > 0) {
      await LocalNotifications.cancel({
        notifications: list.map((n) => ({ id: n.id })),
      });
    }
  } catch {
    // not native
  }
}

export async function scheduleLocalLessonRemindersFromSnapshot(
  snapshot: ShiftSnapshot,
  memberId: string | null,
  role: string | null,
  copyForEntry: (time: string, label: string) => LocalReminderCopy
): Promise<void> {
  if (!readLessonRemindersEnabled()) {
    await cancelAllLocalLessonReminders();
    return;
  }

  if (!memberId || role === "accountant") {
    await cancelAllLocalLessonReminders();
    return;
  }

  const nowMs = Date.now();
  const notifications: {
    id: number;
    title: string;
    body: string;
    schedule: { at: Date };
    channelId?: string;
    extra?: Record<string, string>;
  }[] = [];

  for (const entry of snapshot.scheduleDates) {
    if (!entry.teacherMemberId || entry.teacherMemberId !== memberId) {
      continue;
    }

    const lessonAt = wallClockInTimeZoneToDate(entry.date, entry.time, snapshot.timezone);
    if (!lessonAt) continue;

    const remindAt = new Date(lessonAt.getTime() - LEAD_MINUTES * 60_000);
    if (remindAt.getTime() <= nowMs) continue;

    const label = entry.label?.trim() || "lesson";
    const { title, body } = copyForEntry(entry.time, label);
    const id = stableNotificationId([
      snapshot.organizationId,
      memberId,
      entry.date,
      entry.time,
      entry.slotId ?? "",
      entry.scheduleGroupId ?? "",
    ]);

    notifications.push({
      id,
      title,
      body,
      schedule: { at: remindAt },
      channelId: CHANNEL_ID,
    });
  }

  await cancelAllLocalLessonReminders();
  if (notifications.length === 0) return;

  await ensureAndroidChannel();
  await LocalNotifications.schedule({ notifications });
}
