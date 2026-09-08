const ORG_SELECTION_AFTER_LOGIN_KEY = "tangodb:select-organization-after-login";

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function requestOrganizationSelectionAfterLogin(userId: string | null | undefined): void {
  if (!userId || !canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(ORG_SELECTION_AFTER_LOGIN_KEY, userId);
  } catch {
    /* private mode / quota */
  }
}

export function shouldSelectOrganizationAfterLogin(userId: string | null | undefined): boolean {
  if (!userId || !canUseSessionStorage()) return false;
  try {
    return sessionStorage.getItem(ORG_SELECTION_AFTER_LOGIN_KEY) === userId;
  } catch {
    return false;
  }
}

export function clearOrganizationSelectionAfterLogin(userId?: string | null): void {
  if (!canUseSessionStorage()) return;
  try {
    if (!userId || sessionStorage.getItem(ORG_SELECTION_AFTER_LOGIN_KEY) === userId) {
      sessionStorage.removeItem(ORG_SELECTION_AFTER_LOGIN_KEY);
    }
  } catch {
    /* private mode / quota */
  }
}
