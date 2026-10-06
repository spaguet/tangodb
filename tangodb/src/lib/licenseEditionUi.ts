import type { OrgEditionSnapshot, ProductEdition } from "./orgEdition";
import {
  EDITION_RANK,
  liveProMonthlyInstrument,
  liveStudioMonthlyInstrument,
} from "./orgEdition";

export function hasLiveProLifetime(snapshot: OrgEditionSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  return snapshot.liveInstruments.some(
    (row) =>
      row.instrument === "pro_lifetime" &&
      (row.phase === "active" || row.status === "active")
  );
}

export function hasCancellableMonthly(snapshot: OrgEditionSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  return snapshot.liveInstruments.some(
    (row) =>
      (row.instrument === "studio_monthly" || row.instrument === "pro_monthly") &&
      (row.phase === "active" || row.phase === "past_due")
  );
}

/** Owner can raise active edition without payment (lifetime or active month, not grace-only). */
export function canRestoreEditionViaMode(
  snapshot: OrgEditionSnapshot | null | undefined,
  target: ProductEdition
): boolean {
  if (!snapshot || snapshot.activeEdition === target) return false;
  if (EDITION_RANK[target] <= EDITION_RANK[snapshot.activeEdition]) return false;
  if (EDITION_RANK[target] > EDITION_RANK[snapshot.effectiveCeiling]) return false;

  if (target === "pro") {
    if (hasLiveProLifetime(snapshot)) return true;
    const proMonth = liveProMonthlyInstrument(snapshot);
    return proMonth?.phase === "active";
  }
  if (target === "studio") {
    const studio = liveStudioMonthlyInstrument(snapshot);
    return studio?.phase === "active";
  }
  return false;
}

export function canSwitchModeDown(
  snapshot: OrgEditionSnapshot | null | undefined,
  target: ProductEdition
): boolean {
  if (!snapshot || snapshot.activeEdition === target) return false;
  if (EDITION_RANK[target] >= EDITION_RANK[snapshot.activeEdition]) return false;
  return EDITION_RANK[target] <= EDITION_RANK[snapshot.effectiveCeiling];
}

export function purchaseTargetForEdition(edition: ProductEdition): string {
  if (edition === "studio") return "/settings/license?purchase=1&plan=studio";
  if (edition === "pro") return "/settings/license?purchase=1&plan=monthly";
  return "/settings/license?purchase=1";
}

export function freezeCapabilityKeysForModeDown(
  from: ProductEdition,
  to: ProductEdition
): readonly string[] {
  const keys: string[] = [];
  if (EDITION_RANK[from] >= EDITION_RANK.studio && EDITION_RANK[to] < EDITION_RANK.studio) {
    keys.push(
      "license.edition.freeze.groupSubscriptions",
      "license.edition.freeze.personalLessons",
      "license.edition.freeze.prices"
    );
  }
  if (EDITION_RANK[from] >= EDITION_RANK.pro && EDITION_RANK[to] < EDITION_RANK.pro) {
    keys.push(
      "license.edition.freeze.finance",
      "license.edition.freeze.hallRent",
      "license.edition.freeze.miniApp",
      "license.edition.freeze.googleCalendar"
    );
  }
  return keys;
}
