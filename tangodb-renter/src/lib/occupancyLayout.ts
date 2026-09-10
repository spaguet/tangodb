import { timeToMinutes } from "./grid";

/** Match CRM `scheduleLayout`: 15-min visual rows at 16px. Booking step stays 30 min. */
export const GRID_ROW_HEIGHT_PX = 16;
export const GRID_LAYOUT_SLOT_MINUTES = 15;

export function occupancyTopPx(timeStart: string, rangeStartMin: number): number {
  return ((timeToMinutes(timeStart) - rangeStartMin) / GRID_LAYOUT_SLOT_MINUTES) * GRID_ROW_HEIGHT_PX;
}

export function occupancyHeightPx(timeStart: string, timeEnd: string): number {
  const duration = timeToMinutes(timeEnd) - timeToMinutes(timeStart);
  return Math.max((duration / GRID_LAYOUT_SLOT_MINUTES) * GRID_ROW_HEIGHT_PX, GRID_ROW_HEIGHT_PX);
}

export function occupancyGridHeightPx(rangeStartMin: number, rangeEndMin: number): number {
  return ((rangeEndMin - rangeStartMin) / GRID_LAYOUT_SLOT_MINUTES) * GRID_ROW_HEIGHT_PX;
}

export function formatHourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
