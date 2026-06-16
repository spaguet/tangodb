import { useEffect, useRef, useState } from "react";

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
): string | undefined {
  if (connectionState === "offline") return "Нет соединения";
  if (connectionState === "server-unreachable") return "Сервер недоступен";
  return undefined;
}

export function getMutationBlockedMessage(
  connectionState: ConnectionState
): string {
  if (connectionState === "offline") {
    return "Нет соединения. Действие недоступно offline";
  }
  if (connectionState === "server-unreachable") {
    return "Сервер недоступен. Действие временно невозможно";
  }
  return "";
}

export function useOnlineStatus(): {
  isOnline: boolean;
  isServerReachable: boolean;
  connectionState: ConnectionState;
  justReconnected: boolean;
} {
  const [isOnline, setIsOnline] = useState(
    () => (typeof navigator !== "undefined" ? navigator.onLine : true)
  );
  const [isServerReachable, setIsServerReachable] = useState(true);
  const [justReconnected, setJustReconnected] = useState(false);
  const wasOfflineRef = useRef(false);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveFailuresRef = useRef(0);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      consecutiveFailuresRef.current = 0;
      if (wasOfflineRef.current) {
        setJustReconnected(true);
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          setJustReconnected(false);
        }, 3000);
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
        setIsServerReachable(true);
      } else {
        consecutiveFailuresRef.current += 1;
        if (consecutiveFailuresRef.current >= CONSECUTIVE_FAILURES_THRESHOLD) {
          setIsServerReachable(false);
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

  return { isOnline, isServerReachable, connectionState, justReconnected };
}
