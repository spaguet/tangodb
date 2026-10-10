/** Caps for cron workers that call PostgREST in a loop. Pure: safe to unit-test from Node. */

/**
 * Cron tick is depth 0. Each self-call increments depth.
 * Depth 3 runs, but does not chain again (3 follow-ups after the cron tick).
 */
export const MAX_CALENDAR_SYNC_CHAIN_DEPTH = 3;

/** Claim rounds per calendar-sync invocation. Stops a full outbox from filling the cron interval. */
export const MAX_CALENDAR_SYNC_BATCHES = 2;

export function parseChainDepth(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const floored = Math.floor(value);
  if (floored <= 0) return 0;
  return Math.min(floored, MAX_CALENDAR_SYNC_CHAIN_DEPTH);
}

/** Next self-call depth, or null when this tick must not chain. */
export function nextCalendarSyncChainDepth(current: number): number | null {
  if (current >= MAX_CALENDAR_SYNC_CHAIN_DEPTH) return null;
  return current + 1;
}

/** A fresh cron tick yields while another worker still holds a job lease. Chains do not. */
export function shouldSkipCalendarSyncTick(chainDepth: number, leaseHeld: boolean): boolean {
  return chainDepth === 0 && leaseHeld;
}

/** Self-call only while this tick actually finished jobs and the queue is still full. */
export function shouldChainCalendarSync(input: {
  chainDepth: number;
  shouldContinue: boolean;
  processed: number;
}): boolean {
  if (!input.shouldContinue || input.processed <= 0) return false;
  return nextCalendarSyncChainDepth(input.chainDepth) != null;
}
