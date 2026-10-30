import { PushNotifications } from "@capacitor/push-notifications";
import { getCrmInstallId } from "./installId";
import { readLessonRemindersEnabled } from "./preferences";
import { cancelAllLocalLessonReminders } from "./localReminders";
import { staffPushRpc } from "./rpc";

let pushListenersBound = false;

export async function revokeStaffPushRegistration(): Promise<void> {
  const installId = getCrmInstallId();
  try {
    await staffPushRpc("revoke_crm_staff_push_device", { p_install_id: installId });
  } catch {
    // offline / web
  }
  try {
    await PushNotifications.removeAllListeners();
    await PushNotifications.unregister();
  } catch {
    // not native
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

function bindPushListeners(): void {
  if (pushListenersBound) return;
  pushListenersBound = true;

  void PushNotifications.addListener("registration", (event) => {
    void registerTokenWithServer(event.value);
  });

  void PushNotifications.addListener("registrationError", () => {
    // google-services.json may be absent in dev builds
  });
}

export async function ensureStaffPushRegistration(role: string | null): Promise<void> {
  if (role === "accountant" || !readLessonRemindersEnabled()) {
    await revokeStaffPushRegistration();
    return;
  }

  bindPushListeners();

  let perm = await PushNotifications.checkPermissions();
  if (perm.receive === "prompt") {
    perm = await PushNotifications.requestPermissions();
  }
  if (perm.receive !== "granted") return;

  await PushNotifications.register();
}

export async function clearStaffPushOnNamespaceChange(): Promise<void> {
  await revokeStaffPushRegistration();
}
