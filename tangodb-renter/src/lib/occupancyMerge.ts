import { rangesOverlap, SLOT_MINUTES, timeToMinutes } from "./grid";
import type { BusySlot, MineSlot } from "./types";

export type SlotState = "free" | "busy" | "mine" | "mine_hold" | "mine_debt";

export function classifyInterval(
  date: string,
  timeStart: string,
  timeEnd: string,
  busy: BusySlot[],
  mine: MineSlot[]
): SlotState {
  const s1 = timeToMinutes(timeStart);
  const e1 = timeToMinutes(timeEnd);

  for (const m of mine) {
    if (m.date !== date) continue;
    const s2 = timeToMinutes(m.time_start);
    const e2 = timeToMinutes(m.time_end);
    if (rangesOverlap(s1, e1, s2, e2)) {
      if (m.lifecycle === "awaiting_payment") return "mine_hold";
      if (m.lifecycle === "debt") return "mine_debt";
      return "mine";
    }
  }

  for (const b of busy) {
    if (b.date !== date) continue;
    const s2 = timeToMinutes(b.time_start);
    const e2 = timeToMinutes(b.time_end);
    if (rangesOverlap(s1, e1, s2, e2)) {
      return "busy";
    }
  }

  return "free";
}

/** Classify each 30-min grid cell for a day (start time of cell). */
export function daySlotStates(
  date: string,
  slotStarts: string[],
  busy: BusySlot[],
  mine: MineSlot[]
): Map<string, SlotState> {
  const map = new Map<string, SlotState>();
  for (const start of slotStarts) {
    const startMin = timeToMinutes(start);
    const end = `${String(Math.floor((startMin + 30) / 60)).padStart(2, "0")}:${String((startMin + 30) % 60).padStart(2, "0")}`;
    map.set(start, classifyInterval(date, start, end, busy, mine));
  }
  return map;
}

/** Own booking that covers this 30-min cell (any overlap, not only exact start). */
export function findOverlappingMine(
  date: string,
  timeStart: string,
  mine: MineSlot[]
): MineSlot | undefined {
  const s1 = timeToMinutes(timeStart);
  const e1 = s1 + SLOT_MINUTES;
  return mine.find((m) => {
    if (m.date !== date) return false;
    return rangesOverlap(s1, e1, timeToMinutes(m.time_start), timeToMinutes(m.time_end));
  });
}
