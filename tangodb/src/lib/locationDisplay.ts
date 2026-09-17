import type { Location } from "../hooks/useLocations";

const DRAFT_LOCATION_NAME_RE = /тестов/i;
const DRAFT_ADDRESS_RE = /небытия/i;

/** Onboarding / wizard junk halls (e.g. «Тестовый зал», «Ул. Небытия»). */
export function isDraftTestLocation(loc: Pick<Location, "name" | "address">): boolean {
  const name = loc.name.trim();
  const address = (loc.address || "").trim();
  return DRAFT_LOCATION_NAME_RE.test(name) || DRAFT_ADDRESS_RE.test(address);
}

export function scheduleLocationDisplayName(
  loc: Pick<Location, "name" | "address">,
  draftBadge: string
): string {
  if (!isDraftTestLocation(loc)) return loc.name;
  return `${loc.name} (${draftBadge})`;
}

/** Hide from schedule chrome when the hall has no lessons this week (data stays in DB). */
export function shouldHideEmptyDraftLocation(
  loc: Pick<Location, "name" | "address">,
  lessonCount: number
): boolean {
  return lessonCount === 0 && isDraftTestLocation(loc);
}
