import { registerPlugin } from "@capacitor/core";

export interface ApkInstallerPlugin {
  installApk(options: { path: string }): Promise<void>;
  getVersionCode(): Promise<{ versionCode: number }>;
}

export const ApkInstaller = registerPlugin<ApkInstallerPlugin>("ApkInstaller");
