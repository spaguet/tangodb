export type BeginnerHintId =
  | "first-day-checklist"
  | "attendance"
  | "clients"
  | "schedule"
  | "prices";

export const BEGINNER_HINTS_CHANGED_EVENT = "tangodb:beginner-hints-changed";

function dismissedStorageKey(organizationId: string) {
  return `tangodb:beginner-hints:dismissed:${organizationId}`;
}

function checklistHiddenKey(organizationId: string) {
  return `tangodb:first-day-checklist:hidden-until-settings:${organizationId}`;
}

function notifyHintsChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(BEGINNER_HINTS_CHANGED_EVENT));
}

export function readDismissedHintIds(organizationId: string): Set<BeginnerHintId> {
  if (!organizationId) return new Set();
  try {
    const raw = localStorage.getItem(dismissedStorageKey(organizationId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is BeginnerHintId => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function writeDismissedHintIds(organizationId: string, ids: Set<BeginnerHintId>) {
  if (!organizationId) return;
  try {
    localStorage.setItem(dismissedStorageKey(organizationId), JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
  notifyHintsChanged();
}

export function dismissBeginnerHint(organizationId: string, hintId: BeginnerHintId) {
  const next = readDismissedHintIds(organizationId);
  next.add(hintId);
  writeDismissedHintIds(organizationId, next);
}

export function restoreBeginnerHint(organizationId: string, hintId: BeginnerHintId) {
  const next = readDismissedHintIds(organizationId);
  next.delete(hintId);
  writeDismissedHintIds(organizationId, next);
}

export function clearAllDismissedBeginnerHints(organizationId: string) {
  if (!organizationId) return;
  try {
    localStorage.removeItem(dismissedStorageKey(organizationId));
  } catch {
    /* ignore */
  }
  notifyHintsChanged();
}

export function isFirstDayChecklistHiddenUntilSettings(organizationId: string): boolean {
  if (!organizationId) return false;
  try {
    return localStorage.getItem(checklistHiddenKey(organizationId)) === "1";
  } catch {
    return false;
  }
}

export function hideFirstDayChecklistUntilSettings(organizationId: string) {
  if (!organizationId) return;
  try {
    localStorage.setItem(checklistHiddenKey(organizationId), "1");
    dismissBeginnerHint(organizationId, "first-day-checklist");
  } catch {
    /* ignore */
  }
  notifyHintsChanged();
}

export function showFirstDayChecklistAgain(organizationId: string) {
  if (!organizationId) return;
  try {
    localStorage.removeItem(checklistHiddenKey(organizationId));
  } catch {
    /* ignore */
  }
  restoreBeginnerHint(organizationId, "first-day-checklist");
  notifyHintsChanged();
}

export function panelPathToBeginnerHintId(pathname: string): BeginnerHintId | null {
  if (pathname === "/attendance") return "attendance";
  if (pathname === "/clients") return "clients";
  if (pathname === "/schedule") return "schedule";
  if (pathname === "/prices") return "prices";
  return null;
}
