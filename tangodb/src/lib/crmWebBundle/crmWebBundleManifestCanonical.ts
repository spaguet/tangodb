export function canonicalWebBundleManifestPayload(manifest: Record<string, unknown>): string {
  const copy: Record<string, unknown> = { ...manifest };
  delete copy.signature;
  const keys = Object.keys(copy).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) {
    sorted[key] = copy[key];
  }
  return JSON.stringify(sorted);
}
