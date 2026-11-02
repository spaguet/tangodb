/** Custom-scheme return from the system browser into the Capacitor shell. */

export const NATIVE_AUTH_RETURN_URL_BASE = "tangodb://auth-return";
export const NATIVE_AUTH_HANDOFF_PARAM = "native_handoff";
export const NATIVE_AUTH_RETURN_FAILED_EVENT = "tangodb-native-auth-failed";

export type NativeAuthReturnTokens = {
  accessToken: string;
  refreshToken: string;
  rememberMe: boolean;
};

function readTokens(params: URLSearchParams): NativeAuthReturnTokens | null {
  const accessToken = params.get("access_token")?.trim() ?? "";
  const refreshToken = params.get("refresh_token")?.trim() ?? "";
  if (!accessToken || !refreshToken) return null;
  return {
    accessToken,
    refreshToken,
    rememberMe: params.get("remember") !== "0",
  };
}

/**
 * Android VIEW intents drop the URL fragment, so the return uses the query.
 * The hash is accepted only as a fallback. The URL is a custom scheme, not https.
 */
export function parseNativeAuthReturn(raw: string): NativeAuthReturnTokens | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "tangodb:" || url.hostname !== "auth-return") return null;
  return readTokens(url.searchParams) ?? readTokens(new URLSearchParams(url.hash.replace(/^#/, "")));
}

export function buildNativeAuthReturnUrl(
  tokens: { accessToken: string; refreshToken: string },
  rememberMe: boolean
): string {
  const params = new URLSearchParams({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    remember: rememberMe ? "1" : "0",
  });
  return `${NATIVE_AUTH_RETURN_URL_BASE}?${params.toString()}`;
}

export function isNativeAuthHandoffSearch(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw).get(NATIVE_AUTH_HANDOFF_PARAM) === "1";
}

export function buildNativeLoginPageUrl(siteUrl: string): string {
  const base = siteUrl.trim().replace(/\/$/, "");
  const url = new URL("/login", `${base}/`);
  url.searchParams.set(NATIVE_AUTH_HANDOFF_PARAM, "1");
  return url.toString();
}
