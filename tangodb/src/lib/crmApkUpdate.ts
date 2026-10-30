import { Filesystem, Directory } from "@capacitor/filesystem";
import { ApkInstaller } from "./apkInstaller";
import { isNativeCrmShell } from "./platform";

/** HTTPS origin baked into release builds (`VITE_CRM_APK_UPDATE_ORIGIN`). */
export function getCrmApkUpdateOrigin(): string | null {
  const raw = import.meta.env.VITE_CRM_APK_UPDATE_ORIGIN as string | undefined;
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return null;
  }
}

export type CrmApkManifest = {
  versionCode: number;
  versionName: string;
  minVersionCode: number;
  apkUrl: string;
  sha256: string;
  releaseNotes?: string;
};

const MANIFEST_PATH = "/android/latest.json";

function assertSameOrigin(url: string, trustedOrigin: string): void {
  const parsed = new URL(url);
  if (parsed.origin !== trustedOrigin) {
    throw new Error("APK update manifest points to an untrusted origin");
  }
}

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export async function fetchCrmApkManifest(): Promise<CrmApkManifest | null> {
  const origin = getCrmApkUpdateOrigin();
  if (!origin || !isNativeCrmShell()) return null;

  const manifestUrl = `${origin}${MANIFEST_PATH}`;
  const response = await fetch(manifestUrl, { redirect: "error" });
  if (!response.ok) return null;

  assertSameOrigin(response.url, origin);
  const data = (await response.json()) as CrmApkManifest;
  assertSameOrigin(data.apkUrl, origin);
  return data;
}

export async function getInstalledShellVersionCode(): Promise<number> {
  const { versionCode } = await ApkInstaller.getVersionCode();
  return versionCode;
}

export async function downloadAndInstallCrmApk(manifest: CrmApkManifest): Promise<void> {
  const origin = getCrmApkUpdateOrigin();
  if (!origin) throw new Error("Update origin is not configured");

  assertSameOrigin(manifest.apkUrl, origin);

  const response = await fetch(manifest.apkUrl, { redirect: "error" });
  if (!response.ok) throw new Error("Failed to download APK");

  assertSameOrigin(response.url, origin);

  const buffer = await response.arrayBuffer();
  const hash = (await sha256Hex(buffer)).toLowerCase();
  const expected = manifest.sha256.trim().toLowerCase();
  if (expected && hash !== expected) {
    throw new Error("APK checksum mismatch");
  }

  const base64 = arrayBufferToBase64(buffer);
  const fileName = `tangodb-crm-${manifest.versionCode}.apk`;
  const written = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });

  await ApkInstaller.installApk({ path: written.uri });
}

export type CrmApkUpdateOffer =
  | { kind: "none" }
  | { kind: "required"; manifest: CrmApkManifest }
  | { kind: "optional"; manifest: CrmApkManifest };

export async function checkCrmApkUpdate(): Promise<CrmApkUpdateOffer> {
  if (!isNativeCrmShell()) return { kind: "none" };

  const manifest = await fetchCrmApkManifest();
  if (!manifest) return { kind: "none" };

  const installed = await getInstalledShellVersionCode();
  if (installed < manifest.minVersionCode) {
    return { kind: "required", manifest };
  }
  if (manifest.versionCode > installed) {
    return { kind: "optional", manifest };
  }
  return { kind: "none" };
}
