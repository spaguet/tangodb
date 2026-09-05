const INVITE_TOKEN_RE = /^TDB-INV-([0-9a-fA-F]{32})$/;

declare global {
  interface Window {
    __TDB_INVITE_TOKEN__?: string;
  }
}

export function normalizeInviteToken(raw: string): string {
  const cleaned = raw.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  let decoded = cleaned;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    decoded = cleaned;
  }
  const match = INVITE_TOKEN_RE.exec(decoded);
  if (!match) return "";
  return `TDB-INV-${match[1].toLowerCase()}`;
}

function readTokenFromSearchAndHash(search: string, hash: string): string {
  const fromQuery = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get(
    "token"
  );
  const queryToken = normalizeInviteToken(fromQuery ?? "");
  if (queryToken) return queryToken;

  const hashBody = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!hashBody) return "";

  const fromHashParams = normalizeInviteToken(new URLSearchParams(hashBody).get("token") ?? "");
  if (fromHashParams) return fromHashParams;

  if (hashBody.startsWith("token=")) {
    return normalizeInviteToken(hashBody.slice("token=".length));
  }

  return "";
}

/** URL token wins; stash is only for when Telegram wiped the hash after boot. */
export function parseInviteTokenFromLocation(search: string, hash: string, stashed = ""): string {
  const fromUrl = readTokenFromSearchAndHash(search, hash);
  if (fromUrl) return fromUrl;

  return normalizeInviteToken(stashed);
}

function syncStashedInviteToken(token: string): void {
  if (typeof window === "undefined" || !token) return;
  window.__TDB_INVITE_TOKEN__ = token;
}

/** Read invite token from the current URL (hash/query first, boot stash as fallback). */
export function extractInviteTokenFromUrl(): string {
  if (typeof window === "undefined") return "";
  const token = parseInviteTokenFromLocation(
    window.location.search,
    window.location.hash,
    window.__TDB_INVITE_TOKEN__ ?? ""
  );
  if (token) syncStashedInviteToken(token);
  return token;
}

export function clearStashedInviteToken(): void {
  if (typeof window === "undefined") return;
  try {
    delete window.__TDB_INVITE_TOKEN__;
  } catch {
    window.__TDB_INVITE_TOKEN__ = undefined;
  }
}

/** Remove invite token from address bar immediately after reading (M58). */
export function scrubInviteTokenFromUrl(): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  let changed = false;

  if (url.searchParams.has("token")) {
    url.searchParams.delete("token");
    changed = true;
  }

  const hashBody = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (hashBody) {
    const params = new URLSearchParams(hashBody);
    if (params.has("token") || hashBody.startsWith("token=")) {
      params.delete("token");
      const rest = params.toString();
      url.hash = rest ? `#${rest}` : "";
      changed = true;
    }
  }

  if (changed) {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
}
