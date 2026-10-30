import { useCallback, useEffect } from "react";
import { useOfflineStore } from "../store/offline";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePermissions } from "./usePermissions";
import { useI18n } from "./useI18n";
import { isNativeCrmShell } from "../lib/platform";
import { scheduleLocalLessonRemindersFromSnapshot } from "../lib/staffPush/localReminders";
import { ensureStaffPushRegistration, revokeStaffPushRegistration } from "../lib/staffPush/fcmClient";
import { useStaffNotificationsUiStore } from "../lib/staffPush/uiStore";

/** Side effects for native lesson reminders (mount once in PhoneNotificationsBridge). */
export function useStaffLessonNotificationsEffects() {
  const snapshot = useOfflineStore((s) => s.snapshot);
  const { memberId } = useOrganization();
  const { role } = usePermissions();
  const { t } = useI18n();
  const enabled = useStaffNotificationsUiStore((s) => s.lessonRemindersEnabled);

  const copyForEntry = useCallback(
    (time: string, label: string) => ({
      title: t("phone.notifications.localTitle"),
      body: t("phone.notifications.localBody", { time, label }),
    }),
    [t]
  );

  useEffect(() => {
    if (!isNativeCrmShell()) return;
    if (!enabled || role === "accountant") {
      void revokeStaffPushRegistration();
      return;
    }
    void ensureStaffPushRegistration(role);
  }, [enabled, role, memberId]);

  useEffect(() => {
    if (!isNativeCrmShell() || !enabled || !snapshot || !memberId) return;
    void scheduleLocalLessonRemindersFromSnapshot(snapshot, memberId, role, copyForEntry);
  }, [snapshot, memberId, role, enabled, copyForEntry]);
}

export function useStaffLessonNotificationsToggle() {
  const enabled = useStaffNotificationsUiStore((s) => s.lessonRemindersEnabled);
  const setEnabledStore = useStaffNotificationsUiStore((s) => s.setLessonRemindersEnabled);
  const snapshot = useOfflineStore((s) => s.snapshot);
  const { memberId } = useOrganization();
  const { role } = usePermissions();
  const { t } = useI18n();

  const setLessonRemindersEnabled = useCallback(
    async (next: boolean) => {
      setEnabledStore(next);
      if (!next) {
        await revokeStaffPushRegistration();
        return;
      }
      if (!isNativeCrmShell()) return;
      await ensureStaffPushRegistration(role);
      if (snapshot && memberId) {
        const copyForEntry = (time: string, label: string) => ({
          title: t("phone.notifications.localTitle"),
          body: t("phone.notifications.localBody", { time, label }),
        });
        await scheduleLocalLessonRemindersFromSnapshot(snapshot, memberId, role, copyForEntry);
      }
    },
    [memberId, role, setEnabledStore, snapshot, t]
  );

  return { lessonRemindersEnabled: enabled, setLessonRemindersEnabled };
}
