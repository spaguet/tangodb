const PENDING_INVITE_KEY = "tangodb_pending_invite_token";

export function storePendingInviteToken(token: string) {
  sessionStorage.setItem(PENDING_INVITE_KEY, token);
}

export function consumePendingInviteToken(): string | null {
  const token = sessionStorage.getItem(PENDING_INVITE_KEY);
  if (token) sessionStorage.removeItem(PENDING_INVITE_KEY);
  return token;
}

export function hasPendingInviteToken(): boolean {
  return Boolean(sessionStorage.getItem(PENDING_INVITE_KEY));
}

export function peekPendingInviteToken(): string | null {
  return sessionStorage.getItem(PENDING_INVITE_KEY);
}

export function clearPendingInviteToken() {
  sessionStorage.removeItem(PENDING_INVITE_KEY);
}
