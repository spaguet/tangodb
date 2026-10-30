const PREFS_KEY = "tangodb-crm-lesson-reminders-enabled";

export function readLessonRemindersEnabled(): boolean {
  if (typeof localStorage === "undefined") return false;
  const raw = localStorage.getItem(PREFS_KEY);
  if (raw === null) return true;
  return raw !== "0";
}

export function writeLessonRemindersEnabled(enabled: boolean): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PREFS_KEY, enabled ? "1" : "0");
}

export function readNotificationsPromptDismissed(): boolean {
  if (typeof localStorage === "undefined") return true;
  return localStorage.getItem("tangodb-crm-notifications-prompt-dismissed") === "1";
}

export function writeNotificationsPromptDismissed(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem("tangodb-crm-notifications-prompt-dismissed", "1");
}
