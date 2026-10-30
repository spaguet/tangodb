import { registerPlugin } from "@capacitor/core";

export type WebBundleInstallMeta = {
  appVersion: string;
  bundleHash: string;
};

export type WebBundleInstallResult = {
  path: string;
  appVersion: string;
  bundleHash: string;
};

export type WebBundleInstalledMeta =
  | { empty: true; appVersion?: undefined; bundleHash?: undefined }
  | { appVersion: string; bundleHash: string; empty?: undefined };

export interface WebBundleInstallerPlugin {
  installFromZip(options: {
    zipPath: string;
    appVersion: string;
    bundleHash: string;
  }): Promise<WebBundleInstallResult>;
  getInstalledMeta(): Promise<WebBundleInstalledMeta>;
  rollbackToBackup(): Promise<{ restored: boolean }>;
}

export const WebBundleInstaller = registerPlugin<WebBundleInstallerPlugin>("WebBundleInstaller");
