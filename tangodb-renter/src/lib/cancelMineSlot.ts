import type { SupabaseClient } from "@supabase/supabase-js";
import { mineCancelKind } from "./mineCancel";
import { rpcCancelOccurrence, rpcDeleteHold } from "./rpc";
import type { MineSlot } from "./types";

export async function cancelMineSlot(
  supabase: SupabaseClient,
  slot: MineSlot,
  timezone: string,
  nowMs: number
): Promise<void> {
  if (slot.can_delete_hold === true) {
    await rpcDeleteHold(supabase, slot.id);
    return;
  }
  if (slot.can_cancel_occurrence === true) {
    await rpcCancelOccurrence(supabase, slot.id);
    return;
  }

  const kind = mineCancelKind(slot, timezone, nowMs);
  if (kind === "delete_hold") {
    await rpcDeleteHold(supabase, slot.id);
  } else if (kind === "cancel_occurrence") {
    await rpcCancelOccurrence(supabase, slot.id);
  }
}
