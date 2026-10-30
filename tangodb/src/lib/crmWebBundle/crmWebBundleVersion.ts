import { APP_VERSION } from "../appVersion";

function parseSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export type WebBundleVersionManifest = {
  appVersion: string;
  bundleHash: string;
};

export function isWebBundleManifestNewer(
  manifest: WebBundleVersionManifest,
  installed: { appVersion: string; bundleHash: string } | null,
  bundledAppVersion: string = APP_VERSION
): boolean {
  const baseline = installed?.appVersion
    ? installed
    : { appVersion: bundledAppVersion, bundleHash: "" };

  const next = parseSemver(manifest.appVersion);
  const current = parseSemver(baseline.appVersion);
  if (!next || !current) {
    return manifest.bundleHash !== baseline.bundleHash;
  }
  for (let i = 0; i < 3; i++) {
    if (next[i] !== current[i]) return next[i] > current[i];
  }
  if (!baseline.bundleHash) return true;
  return manifest.bundleHash !== baseline.bundleHash;
}
