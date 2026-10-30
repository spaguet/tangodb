import { Capacitor } from "@capacitor/core";

/** True only inside the Capacitor APK shell — not mobile Chrome or desktop browser. */
export function isNativeCrmShell(): boolean {
  return Capacitor.isNativePlatform();
}
