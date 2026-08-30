import { minutesToTime, normalizeTime, timeToMinutes } from "./scheduleWeek";

/** Mini App grid: start on 30 min; duration min 60 min then 30 min steps. Cashier grid stays 15 min. */
export const MINIAPP_SLOT_MINUTES = 30;
export const MINIAPP_MIN_DURATION_MINUTES = 60;

export function snapMiniAppMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return 0;
  return Math.round(minutes / MINIAPP_SLOT_MINUTES) * MINIAPP_SLOT_MINUTES;
}

export function snapMiniAppTime(time: string): string {
  return minutesToTime(snapMiniAppMinutes(timeToMinutes(normalizeTime(time))));
}

export function miniAppDurationMinutes(timeStart: string, timeEnd: string): number {
  return timeToMinutes(normalizeTime(timeEnd)) - timeToMinutes(normalizeTime(timeStart));
}

export function isMiniAppDurationValid(timeStart: string, timeEnd: string): boolean {
  const duration = miniAppDurationMinutes(timeStart, timeEnd);
  if (duration < MINIAPP_MIN_DURATION_MINUTES) return false;
  return duration % MINIAPP_SLOT_MINUTES === 0;
}

export function miniAppTimeOptions(rangeStartMin = 6 * 60, rangeEndMin = 23 * 60 + 30): string[] {
  const times: string[] = [];
  for (let min = rangeStartMin; min <= rangeEndMin; min += MINIAPP_SLOT_MINUTES) {
    times.push(minutesToTime(min));
  }
  return times;
}

export function miniAppEndOptions(timeStart: string, rangeEndMin = 24 * 60): string[] {
  const start = timeToMinutes(normalizeTime(timeStart));
  const times: string[] = [];
  for (
    let min = start + MINIAPP_MIN_DURATION_MINUTES;
    min <= rangeEndMin;
    min += MINIAPP_SLOT_MINUTES
  ) {
    times.push(minutesToTime(min));
  }
  return times;
}

export function addCalendarDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
