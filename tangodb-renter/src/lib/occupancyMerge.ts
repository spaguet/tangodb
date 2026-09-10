import { GRID_END_MIN, GRID_START_MIN, minutesToTime, rangesOverlap, SLOT_MINUTES, timeToMinutes } from "./grid";
import { occupiesMiniAppGrid } from "./lifecycle";
import type { BusySlot, MineSlot } from "./types";

export type SlotState = "free" | "busy" | "mine" | "mine_hold" | "mine_debt";

export type OccupancyBlock = {
  timeStart: string;
  timeEnd: string;
  state: SlotState;
};

export type OccupiedBlock = OccupancyBlock & { state: Exclude<SlotState, "free"> };

export function isOccupiedBlock(block: OccupancyBlock): block is OccupiedBlock {
  return block.state !== "free";
}

const DISPLAY_DEFAULT_START_MIN = 7 * 60;
const DISPLAY_DEFAULT_END_MIN = 22 * 60;

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
    if (!occupiesMiniAppGrid(m.lifecycle)) continue;
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
    if (!occupiesMiniAppGrid(m.lifecycle)) return false;
    return rangesOverlap(s1, e1, timeToMinutes(m.time_start), timeToMinutes(m.time_end));
  });
}

/** Merge consecutive 30-min cells of the same occupancy state into CRM-style blocks. */
export function mergeSlotStates(
  slotStarts: string[],
  states: Map<string, SlotState>
): OccupancyBlock[] {
  const blocks: OccupancyBlock[] = [];
  for (const start of slotStarts) {
    const state = states.get(start) ?? "free";
    const end = minutesToTime(timeToMinutes(start) + SLOT_MINUTES);
    const last = blocks[blocks.length - 1];
    if (last && last.state === state && last.timeEnd === start) {
      last.timeEnd = end;
    } else {
      blocks.push({ timeStart: start, timeEnd: end, state });
    }
  }
  return blocks;
}

/** Visible hour range for the week grid — same defaults as CRM `computeDisplayRange`. */
export function computeOccupancyDisplayRange(
  intervals: Array<{ time_start: string; time_end: string } | { timeStart: string; timeEnd: string }>
): { start: number; end: number } {
  if (intervals.length === 0) {
    return { start: DISPLAY_DEFAULT_START_MIN, end: DISPLAY_DEFAULT_END_MIN };
  }

  const mins = intervals.flatMap((interval) => {
    const start = "time_start" in interval ? interval.time_start : interval.timeStart;
    const end = "time_end" in interval ? interval.time_end : interval.timeEnd;
    return [timeToMinutes(start), timeToMinutes(end)];
  });
  const start = Math.max(GRID_START_MIN, Math.min(Math.min(...mins), DISPLAY_DEFAULT_START_MIN));
  const end = Math.min(GRID_END_MIN, Math.max(Math.max(...mins), DISPLAY_DEFAULT_END_MIN));
  return {
    start: Math.floor(start / 60) * 60,
    end: Math.ceil(end / 60) * 60,
  };
}
