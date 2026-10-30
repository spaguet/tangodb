import { useStaffLessonNotificationsEffects } from "../../hooks/useStaffLessonNotifications";

/** Mounts staff notification side effects (native shell only). */
export default function PhoneNotificationsBridge() {
  useStaffLessonNotificationsEffects();
  return null;
}
