import { Filesystem, Directory } from "@capacitor/filesystem";
import { WebView } from "@capacitor/core";
import { getCrmApkUpdateOrigin } from "../crmApkUpdate";
import { isNativeCrmShell } from "../platform";
import { WebBundleInstaller } from "../webBundleInstaller";
import { verifyWebBundleManifestSignature } from "./crmWebBundleManifestVerify";
import { isWebBundleManifestNewer } from "./crmWebBundleVersion";

export { isWebBundleManifestNewer };

export type CrmWebBundleManifest = {
  appVersion: string;
  bundleHash: string;
  bundleUrl: string;
  sha256: string;
  releaseNotes?: string;
  signature: string;
};

const MANIFEST_PATH = "/android/web-bundle/latest.json";

export function assertTrustedUpdateUrl(url: string, trustedOrigin: string): void {
  const parsed = new URL(url);
  if (parsed.origin !== trustedOrigin) {
    throw new Error("Web bundle URL points to an untrusted origin");
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

export async function fetchCrmWebBundleManifest(): Promise<CrmWebBundleManifest | null> {
  const origin = getCrmApkUpdateOrigin();
  if (!origin || !isNativeCrmShell()) return null;

  const manifestUrl = `${origin}${MANIFEST_PATH}`;
  const response = await fetch(manifestUrl, { redirect: "error" });
  if (!response.ok) return null;

  assertTrustedUpdateUrl(response.url, origin);
  const raw = (await response.json()) as CrmWebBundleManifest;
  assertTrustedUpdateUrl(raw.bundleUrl, origin);

  const ok = await verifyWebBundleManifestSignature(
    raw as unknown as Record<string, unknown>,
    raw.signature ?? ""
  );
  if (!ok) {
    throw new Error("Web bundle manifest signature invalid");
  }

  return raw;
}

export type CrmWebBundleUpdateOffer =
  | { kind: "none" }
  | { kind: "available"; manifest: CrmWebBundleManifest };

export async function checkCrmWebBundleUpdate(): Promise<CrmWebBundleUpdateOffer> {
  if (!isNativeCrmShell()) return { kind: "none" };

  let manifest: CrmWebBundleManifest | null;
  try {
    manifest = await fetchCrmWebBundleManifest();
  } catch {
    return { kind: "none" };
  }
  if (!manifest) return { kind: "none" };

  const meta = await WebBundleInstaller.getInstalledMeta();
  const installed =
    "empty" in meta && meta.empty
      ? null
      : { appVersion: meta.appVersion, bundleHash: meta.bundleHash };

  if (!isWebBundleManifestNewer(manifest, installed)) {
    return { kind: "none" };
  }

  return { kind: "available", manifest };
}

async function activateWebBundlePath(path: string): Promise<void> {
  await WebView.setServerBasePath({ path });
  await WebView.persistServerBasePath();
}

export async function downloadAndApplyCrmWebBundle(manifest: CrmWebBundleManifest): Promise<void> {
  const origin = getCrmApkUpdateOrigin();
  if (!origin) throw new Error("Update origin is not configured");

  assertTrustedUpdateUrl(manifest.bundleUrl, origin);

  const response = await fetch(manifest.bundleUrl, { redirect: "error" });
  if (!response.ok) throw new Error("Failed to download web bundle");

  assertTrustedUpdateUrl(response.url, origin);

  const buffer = await response.arrayBuffer();
  const hash = (await sha256Hex(buffer)).toLowerCase();
  const expected = manifest.sha256.trim().toLowerCase();
  if (expected && hash !== expected) {
    throw new Error("Web bundle checksum mismatch");
  }

  const base64 = arrayBufferToBase64(buffer);
  const fileName = `tangodb-web-bundle-${manifest.bundleHash}.zip`;
  const written = await Filesystem.writeFile({
    path: fileName,
    data: base64,
    directory: Directory.Cache,
  });

  let installPath: string;
  try {
    const installed = await WebBundleInstaller.installFromZip({
      zipPath: written.uri,
      appVersion: manifest.appVersion,
      bundleHash: manifest.bundleHash,
    });
    installPath = installed.path;
  } catch (err) {
    await WebBundleInstaller.rollbackToBackup();
    throw err;
  }

  try {
    await activateWebBundlePath(installPath);
  } catch (err) {
    const rolled = await WebBundleInstaller.rollbackToBackup();
    if (rolled.restored) {
      await activateWebBundlePath(installPath).catch(() => undefined);
    }
    throw err;
  }
}

export function reloadAfterWebBundleApply(): void {
  window.location.reload();
}
