/** Read invite token from URL once; prefer fragment over query (M58). */
export function extractInviteTokenFromUrl(): string {
  if (typeof window === "undefined") return "";

  const fromQuery = new URLSearchParams(window.location.search).get("token");
  if (fromQuery) return fromQuery;

  const hash = window.location.hash;
  if (hash.startsWith("#token=")) {
    return decodeURIComponent(hash.slice("#token=".length));
  }

  return "";
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
  if (url.hash.startsWith("#token=")) {
    url.hash = "";
    changed = true;
  }

  if (changed) {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
}
