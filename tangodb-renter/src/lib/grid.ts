export const SLOT_MINUTES = 30;
export const MIN_DURATION_MINUTES = 60;
export const GRID_START_MIN = 6 * 60;
export const GRID_END_MIN = 24 * 60;

export function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function snapTime(time: string): string {
  const m = timeToMinutes(time);
  return minutesToTime(Math.round(m / SLOT_MINUTES) * SLOT_MINUTES);
}

export function slotStartOptions(): string[] {
  const out: string[] = [];
  for (let m = GRID_START_MIN; m < GRID_END_MIN; m += SLOT_MINUTES) {
    out.push(minutesToTime(m));
  }
  return out;
}

export function slotEndOptions(timeStart: string): string[] {
  const start = timeToMinutes(timeStart);
  const out: string[] = [];
  for (let m = start + MIN_DURATION_MINUTES; m <= GRID_END_MIN; m += SLOT_MINUTES) {
    out.push(minutesToTime(m));
  }
  return out;
}

export function isValidDuration(timeStart: string, timeEnd: string): boolean {
  const d = timeToMinutes(timeEnd) - timeToMinutes(timeStart);
  return d >= MIN_DURATION_MINUTES && d % SLOT_MINUTES === 0;
}

export function rangesOverlap(
  s1: number,
  e1: number,
  s2: number,
  e2: number
): boolean {
  return s1 < e2 && s2 < e1;
}
