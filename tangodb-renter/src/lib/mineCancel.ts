import { orgZonedDateTimeMs } from "./orgTime";
import type { MineSlot } from "./types";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export type MineCancelKind = "delete_hold" | "cancel_occurrence" | "none";

type MineCancelSlot = Pick<MineSlot, "lifecycle" | "date" | "time_start">;

export function mineCancelKind(
  slot: MineCancelSlot,
  timezone: string,
  nowMs: number
): MineCancelKind {
  if (slot.lifecycle === "awaiting_payment") return "delete_hold";
  if (slot.lifecycle === "active" || slot.lifecycle === "prepaid_charged") {
    const startMs = orgZonedDateTimeMs(timezone, slot.date, slot.time_start);
    if (nowMs < startMs) return "cancel_occurrence";
    return "none";
  }
  return "none";
}

/** True when renter cancel of a paid slot keeps the 50% prepay (now ≥ T−24h). */
export function mineCancelRetainsPrepay(
  slot: MineCancelSlot,
  timezone: string,
  nowMs: number
): boolean {
  if (mineCancelKind(slot, timezone, nowMs) !== "cancel_occurrence") return false;
  const startMs = orgZonedDateTimeMs(timezone, slot.date, slot.time_start);
  return nowMs >= startMs - TWENTY_FOUR_HOURS_MS;
}
