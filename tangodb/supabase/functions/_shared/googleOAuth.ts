/**
 * Google OAuth 2.0 helpers — Authorization Code + PKCE, OIDC id_token, refresh token encryption.
 * Secrets: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI,
 * GOOGLE_TOKEN_ENCRYPTION_KEY (32-byte key, base64url or hex).
 */

import * as jose from "https://deno.land/x/jose@v5.9.6/index.ts";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** MVP strict mode: TangoDB creates its own calendar (§11). */
export const GOOGLE_CALENDAR_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
] as const;

/** Own availability only (single primary-style calendar). */
export const GOOGLE_FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.freebusy";

/** Busy times on calendars the user can access (multiple / non-primary). */
export const GOOGLE_EVENTS_FREEBUSY_SCOPE =
  "https://www.googleapis.com/auth/calendar.events.freebusy";

/** True when the app can only manage calendars it created (not the user's primary). */
export function isAppCreatedCalendarScopeOnly(
  grantedScopes: string[] | null | undefined
): boolean {
  const scopes = new Set(grantedScopes ?? []);
  const hasAppCreated = scopes.has(
    "https://www.googleapis.com/auth/calendar.app.created"
  );
  const hasFullCalendar =
    scopes.has("https://www.googleapis.com/auth/calendar") ||
    scopes.has("https://www.googleapis.com/auth/calendar.events");
  return hasAppCreated && !hasFullCalendar;
}

export function mergeGrantedScopes(
  existing: string[] | null | undefined,
  fromToken: string
): string[] {
  const merged = new Set([
    ...(existing ?? []),
    ...parseGrantedScopes(fromToken),
  ]);
  return [...merged];
}

export function resolveFreebusyConsentScopes(calendarIds: string[]): string[] {
  if (calendarIds.length === 0) return [];
  if (calendarIds.length === 1) return [GOOGLE_FREEBUSY_SCOPE];
  return [GOOGLE_EVENTS_FREEBUSY_SCOPE];
}

export function accountHasFreebusyScopes(
  grantedScopes: string[] | null | undefined,
  calendarIds: string[]
): boolean {
  if (!calendarIds.length) return false;
  const scopes = new Set(grantedScopes ?? []);
  const required = resolveFreebusyConsentScopes(calendarIds);
  return required.every((scope) => scopes.has(scope));
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: CryptoKey;
}

export interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token: string;
}

export interface GoogleIdTokenClaims {
  sub: string;
  email: string;
  email_verified?: boolean;
}

export async function loadGoogleOAuthConfig(): Promise<GoogleOAuthConfig | null> {
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")?.trim();
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")?.trim();
  const redirectUri = Deno.env.get("GOOGLE_OAUTH_REDIRECT_URI")?.trim();
  const keyMaterial = Deno.env.get("GOOGLE_TOKEN_ENCRYPTION_KEY")?.trim();
  if (!clientId || !clientSecret || !redirectUri || !keyMaterial) {
    return null;
  }
  const keyBytes = decodeEncryptionKey(keyMaterial);
  if (!keyBytes) return null;
  const encryptionKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return { clientId, clientSecret, redirectUri, encryptionKey };
}

function decodeEncryptionKey(material: string): Uint8Array | null {
  const trimmed = material.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    const bytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      bytes[i] = parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  try {
    const decoded = base64UrlDecode(trimmed);
    if (decoded.length === 32) return decoded;
  } catch {
    // fall through
  }
  return null;
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function generateOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function generateOidcNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function hashOAuthState(state: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`gcal-oauth-state:${state}`)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createPkcePair(): Promise<{ verifier: string; challenge: string }> {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const verifier = base64UrlEncode(bytes);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

export function getAllowedOrigins(): string[] {
  return (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function isAllowedReturnUrl(returnUrl: string): boolean {
  const origins = getAllowedOrigins();
  if (!origins.length) return false;
  try {
    const parsed = new URL(returnUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return origins.includes(parsed.origin);
  } catch {
    return false;
  }
}

export function defaultIntegrationsReturnUrl(): string | null {
  const origins = getAllowedOrigins();
  if (!origins.length) return null;
  return `${origins[0]}/settings/integrations`;
}

export function buildGoogleAuthUrl(params: {
  config: GoogleOAuthConfig;
  state: string;
  nonce: string;
  codeChallenge: string;
  promptConsent: boolean;
  additionalScopes?: string[];
}): string {
  const scopeSet = new Set<string>([...GOOGLE_CALENDAR_SCOPES]);
  for (const scope of params.additionalScopes ?? []) {
    scopeSet.add(scope);
  }
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", params.config.clientId);
  url.searchParams.set("redirect_uri", params.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", [...scopeSet].join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", params.promptConsent ? "consent" : "select_account");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

export async function exchangeAuthorizationCode(
  config: GoogleOAuthConfig,
  code: string,
  codeVerifier: string
): Promise<GoogleTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await res.json();
  if (!res.ok) {
    const err = payload as { error?: string; error_description?: string };
    throw new GoogleOAuthError(
      err.error ?? "token_exchange_failed",
      err.error_description ?? `HTTP ${res.status}`
    );
  }
  return payload as GoogleTokenResponse;
}

export async function validateGoogleIdToken(
  config: GoogleOAuthConfig,
  idToken: string,
  expectedNonce: string
): Promise<GoogleIdTokenClaims> {
  const jwks = jose.createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  const { payload } = await jose.jwtVerify(idToken, jwks, {
    audience: config.clientId,
    clockTolerance: 30,
  });

  const iss = String(payload.iss ?? "");
  if (!GOOGLE_ISSUERS.has(iss)) {
    throw new GoogleOAuthError("invalid_id_token", "unexpected issuer");
  }
  if (payload.nonce !== expectedNonce) {
    throw new GoogleOAuthError("invalid_id_token", "nonce mismatch");
  }

  const sub = payload.sub;
  const email = payload.email;
  if (typeof sub !== "string" || !sub) {
    throw new GoogleOAuthError("invalid_id_token", "missing sub");
  }
  if (typeof email !== "string" || !email) {
    throw new GoogleOAuthError("invalid_id_token", "missing email");
  }

  return {
    sub,
    email: email.toLowerCase(),
    email_verified: payload.email_verified === true,
  };
}

export function parseGrantedScopes(scope: string): string[] {
  return scope
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const TOKEN_VERSION = 1;
const IV_LENGTH = 12;

export async function encryptRefreshToken(
  key: CryptoKey,
  plaintext: string
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  const out = new Uint8Array(1 + IV_LENGTH + ciphertext.byteLength);
  out[0] = TOKEN_VERSION;
  out.set(iv, 1);
  out.set(new Uint8Array(ciphertext), 1 + IV_LENGTH);
  return out;
}

export async function decryptRefreshToken(
  key: CryptoKey,
  data: Uint8Array
): Promise<string> {
  if (data.length < 1 + IV_LENGTH + 16) {
    throw new GoogleOAuthError("decrypt_failed", "ciphertext too short");
  }
  const version = data[0];
  if (version !== TOKEN_VERSION) {
    throw new GoogleOAuthError("decrypt_failed", `unsupported token_version ${version}`);
  }
  const iv = data.slice(1, 1 + IV_LENGTH);
  const ciphertext = data.slice(1 + IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

export async function refreshGoogleAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string
): Promise<{
  access_token: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
}> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const payload = await res.json();
  if (!res.ok) {
    const err = payload as { error?: string; error_description?: string };
    throw new GoogleOAuthError(
      err.error ?? "refresh_failed",
      err.error_description ?? `HTTP ${res.status}`
    );
  }
  return payload as {
    access_token: string;
    expires_in: number;
    scope?: string;
    refresh_token?: string;
  };
}

export async function revokeGoogleToken(token: string): Promise<void> {
  const res = await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok && res.status !== 400) {
    throw new GoogleOAuthError("revoke_failed", `HTTP ${res.status}`);
  }
}

export class GoogleOAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

/** PostgREST bytea ↔ Uint8Array helpers. */
export function byteaToUint8Array(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    const hex = value.startsWith("\\x") ? value.slice(2) : value;
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  return null;
}

export function uint8ArrayToByteaHex(bytes: Uint8Array): string {
  return "\\x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function buildOAuthCallbackRedirect(
  returnUrl: string,
  result: { ok: true } | { ok: false; reason: string }
): string {
  const url = new URL(returnUrl);
  if (result.ok) {
    url.searchParams.set("gcal", "success");
  } else {
    url.searchParams.set("gcal", "error");
    url.searchParams.set("reason", result.reason);
  }
  return url.toString();
}
