/** Pending Mini App top-up requests older than this are SLA-breached (owner/director escalation). */
export const RENTER_TOPUP_SLA_MS = 4 * 60 * 60 * 1000;

export function isRenterTopupSlaBreached(createdAt: string, nowMs = Date.now()): boolean {
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return nowMs - created >= RENTER_TOPUP_SLA_MS;
}

export function renterTopupSlaSortKey(createdAt: string, nowMs = Date.now()): number {
  const breached = isRenterTopupSlaBreached(createdAt, nowMs) ? 0 : 1;
  const created = Date.parse(createdAt);
  return breached * 1e15 + (Number.isFinite(created) ? created : 0);
}
