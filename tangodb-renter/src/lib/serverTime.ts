/** Offset (ms) from device clock to server clock: serverNow ≈ Date.now() + offsetMs */
export function computeServerOffsetMs(serverNowIso: string | null | undefined): number {
  if (!serverNowIso) return 0;
  const serverMs = new Date(serverNowIso).getTime();
  if (!Number.isFinite(serverMs)) return 0;
  return serverMs - Date.now();
}

export function serverNowMs(offsetMs: number): number {
  return Date.now() + offsetMs;
}
