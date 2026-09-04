import { useEffect, useRef } from "react";
import { CABINET_POLL_MS } from "../lib/cabinetRefresh";
import { useVisibilityRefetch } from "./useVisibilityRefetch";

/** Single owner of visibility refetch + short polling for the whole cabinet. */
export function useCabinetLiveRefresh(onRefresh: () => void, pollActive: boolean): void {
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useVisibilityRefetch(() => cb.current());

  useEffect(() => {
    if (!pollActive) return;
    const id = window.setInterval(() => cb.current(), CABINET_POLL_MS);
    return () => window.clearInterval(id);
  }, [pollActive]);
}
