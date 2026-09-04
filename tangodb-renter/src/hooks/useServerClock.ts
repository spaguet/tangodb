import { useEffect, useMemo, useRef, useState } from "react";
import { holdCountdown, holdCountdownExpired } from "../lib/format";
import { serverNowMs } from "../lib/serverTime";

const TICK_MS = 30_000;

export function useServerClock(serverNowIso: string | null | undefined) {
  const [offsetMs, setOffsetMs] = useState(0);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!serverNowIso) {
      setOffsetMs(0);
      return;
    }
    const serverMs = new Date(serverNowIso).getTime();
    if (!Number.isFinite(serverMs)) {
      setOffsetMs(0);
      return;
    }
    setOffsetMs(serverMs - Date.now());
  }, [serverNowIso]);

  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const nowMs = useMemo(() => serverNowMs(offsetMs), [offsetMs, tick]);

  return { offsetMs, nowMs, tick };
}

export function useHoldCountdown(
  holdExpiresAt: string | null | undefined,
  enabled: boolean,
  serverNowIso: string | null | undefined,
  onExpired?: () => void
): string | null {
  const { nowMs } = useServerClock(serverNowIso);
  const expiredCalledRef = useRef(false);

  useEffect(() => {
    expiredCalledRef.current = false;
  }, [holdExpiresAt, enabled]);

  const countdown = useMemo(() => {
    if (!enabled || !holdExpiresAt) return null;
    return holdCountdown(holdExpiresAt, nowMs);
  }, [enabled, holdExpiresAt, nowMs]);

  useEffect(() => {
    if (!enabled || !holdExpiresAt || !onExpired || expiredCalledRef.current) return;
    if (holdCountdownExpired(holdExpiresAt, nowMs)) {
      expiredCalledRef.current = true;
      onExpired();
    }
  }, [enabled, holdExpiresAt, nowMs, onExpired]);

  return countdown;
}
