import { useEffect, useRef, useState } from "react";

import type { I18nKey } from "../lib/i18n/keys";

export type ConnectionState = "online" | "offline" | "server-unreachable";

const HEALTH_CHECK_INTERVAL_MS = 30_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const CONSECUTIVE_FAILURES_THRESHOLD = 2;

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
    return fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timeoutId);
  });
}

async function checkSupabaseReachable(): Promise<boolean> {
  if (!supabaseUrl || !supabaseAnonKey) return true;

  try {
    const response = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/clients?select=id&limit=0`,
      {
        method: "HEAD",
        headers: {
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
          Prefer: "count=none",
        },
      },
      HEALTH_CHECK_TIMEOUT_MS
    );
    // 401/403 still mean the server responded; only 5xx or network errors are "down".
    return response.status > 0 && response.status < 500;
  } catch {
    return false;
  }
}

export function getConnectionBlockReason(
  connectionState: ConnectionState
): I18nKey | undefined {
  if (connectionState === "offline") return "common.noConnection";
  if (connectionState === "server-unreachable") return "common.serverUnavailable";
  return undefined;
}

export function getMutationBlockedMessage(
  connectionState: ConnectionState
): I18nKey | undefined {
  if (connectionState === "offline") return "common.offline.actionBlocked";
  if (connectionState === "server-unreachable") return "common.offline.serverActionBlocked";
  return undefined;
}

export function translateConnectionBlockReason(
  connectionState: ConnectionState,
  translate: (key: I18nKey) => string
): string | undefined {
  const key = getConnectionBlockReason(connectionState);
  return key ? translate(key) : undefined;
}

export function translateMutationBlockedMessage(
  connectionState: ConnectionState,
  translate: (key: I18nKey) => string
): string | undefined {
  const key = getMutationBlockedMessage(connectionState);
  return key ? translate(key) : undefined;
}

export function useOnlineStatus(): {
  isOnline: boolean;
  isServerReachable: boolean;
  connectionState: ConnectionState;
  justReconnected: boolean;
  justServerReconnected: boolean;
  justConnectionRestored: boolean;
} {
  const [isOnline, setIsOnline] = useState(
    () => (typeof navigator !== "undefined" ? navigator.onLine : true)
  );
  const [isServerReachable, setIsServerReachable] = useState(true);
  const [justReconnected, setJustReconnected] = useState(false);
  const [justServerReconnected, setJustServerReconnected] = useState(false);
  const wasOfflineRef = useRef(false);
  const wasServerUnreachableRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveFailuresRef = useRef(0);

  const pulseReconnectFlag = (
    setter: (v: boolean) => void,
    timerRef: { current: ReturnType<typeof setTimeout> | null }
  ) => {
    setter(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setter(false);
    }, 3000);
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      consecutiveFailuresRef.current = 0;
      if (wasOfflineRef.current) {
        pulseReconnectFlag(setJustReconnected, reconnectTimerRef);
      }
      wasOfflineRef.current = false;
    };

    const handleOffline = () => {
      setIsOnline(false);
      wasOfflineRef.current = true;
      setJustReconnected(false);
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (serverReconnectTimerRef.current) clearTimeout(serverReconnectTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!isOnline) return;

    let cancelled = false;

    const runCheck = async () => {
      const ok = await checkSupabaseReachable();
      if (cancelled) return;

      if (ok) {
        consecutiveFailuresRef.current = 0;
        setIsServerReachable((prev) => {
          if (!prev && wasServerUnreachableRef.current) {
            pulseReconnectFlag(setJustServerReconnected, serverReconnectTimerRef);
          }
          return true;
        });
        wasServerUnreachableRef.current = false;
      } else {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= CONSECUTIVE_FAILURES_THRESHOLD) {
          setIsServerReachable(false);
          wasServerUnreachableRef.current = true;
        }
      }
    };

    void runCheck();
    const intervalId = setInterval(runCheck, HEALTH_CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [isOnline]);

  const connectionState: ConnectionState = !isOnline
    ? "offline"
    : isServerReachable
      ? "online"
      : "server-unreachable";

  const justConnectionRestored = justReconnected || justServerReconnected;

  return {
    isOnline,
    isServerReachable,
    connectionState,
    justReconnected,
    justServerReconnected,
    justConnectionRestored,
  };
}
