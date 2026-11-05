import { getCrmInstallId } from "./installId";
import { readLessonRemindersEnabled } from "./preferences";
import { cancelAllLocalLessonReminders } from "./localReminders";
import { staffPushRpc } from "./rpc";

/**
 * Release APKs do not ship google-services.json. Calling the Capacitor push plugin
 * then throws Default FirebaseApp is not initialized and kills the process on launch,
 * because lesson reminders default to on and the permission stays granted.
 */
const FCM_CONFIGURED = false;

let pushListenersBound = false;

export async function revokeStaffPushRegistration(): Promise<void> {
  const installId = getCrmInstallId();
  try {
    await staffPushRpc("revoke_crm_staff_push_device", { p_install_id: installId });
  } catch {
    // offline / web
  }
  if (FCM_CONFIGURED) {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      await PushNotifications.removeAllListeners();
      await PushNotifications.unregister();
    } catch {
      // not native or Firebase missing
    }
  }
  pushListenersBound = false;
  await cancelAllLocalLessonReminders();
}

async function registerTokenWithServer(token: string): Promise<void> {
  if (!readLessonRemindersEnabled()) return;
  await staffPushRpc("register_crm_staff_push_device", {
    p_install_id: getCrmInstallId(),
    p_fcm_token: token,
    p_platform: "android",
  });
}

async function bindPushListeners(): Promise<void> {
  if (pushListenersBound || !FCM_CONFIGURED) return;
  pushListenersBound = true;
  const { PushNotifications } = await import("@capacitor/push-notifications");

  void PushNotifications.addListener("registration", (event) => {
    void registerTokenWithServer(event.value);
  });

  void PushNotifications.addListener("registrationError", () => {
    // google-services.json may be absent in dev builds
  });
}

export async function ensureStaffPushRegistration(role: string | null): Promise<void> {
  if (!FCM_CONFIGURED) return;
  if (role === "accountant" || !readLessonRemindersEnabled()) {
    await revokeStaffPushRegistration();
    return;
  }

  await bindPushListeners();

  try {
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") return;
    await PushNotifications.register();
  } catch {
    // Firebase is not initialized in this build
  }
}

export async function clearStaffPushOnNamespaceChange(): Promise<void> {
  await revokeStaffPushRegistration();
}
