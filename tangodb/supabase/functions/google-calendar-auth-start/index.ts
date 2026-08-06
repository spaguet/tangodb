import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import {
  buildGoogleAuthUrl,
  createPkcePair,
  defaultIntegrationsReturnUrl,
  generateOAuthState,
  generateOidcNonce,
  hashOAuthState,
  isAllowedReturnUrl,
  loadGoogleOAuthConfig,
} from "../_shared/googleOAuth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60_000;
const STATE_TTL_MS = 10 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const config = await loadGoogleOAuthConfig();
  if (!config) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`gcal-auth-start:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: { return_url?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const returnUrl = (body.return_url ?? "").trim() || defaultIntegrationsReturnUrl();
  if (!returnUrl || !isAllowedReturnUrl(returnUrl)) {
    return jsonResponse({ error: "Invalid return_url" }, 400, req);
  }

  const admin = createServiceClient();
  const userId = userData.user.id;

  const { data: existingAccounts } = await admin
    .from("user_google_accounts")
    .select("id, status, encrypted_refresh_token")
    .eq("user_id", userId);

  const hasStoredCredential = (existingAccounts ?? []).some(
    (row) => row.encrypted_refresh_token != null
  );
  const needsReconsent = (existingAccounts ?? []).some(
    (row) => row.status === "revoked" || row.status === "error"
  );
  const promptConsent = !hasStoredCredential || needsReconsent || (existingAccounts ?? []).length === 0;

  const state = generateOAuthState();
  const nonce = generateOidcNonce();
  const { verifier, challenge } = await createPkcePair();
  const stateHash = await hashOAuthState(state);
  const expiresAt = new Date(Date.now() + STATE_TTL_MS).toISOString();

  const { error: insertError } = await admin.from("google_oauth_states").insert({
    state_hash: stateHash,
    user_id: userId,
    oidc_nonce: nonce,
    pkce_verifier: verifier,
    return_url: returnUrl,
    expires_at: expiresAt,
  });

  if (insertError) {
    logEvent("gcal_auth_start_error", { code: insertError.code ?? "insert_failed" });
    return jsonResponse({ error: "Failed to start OAuth" }, 500, req);
  }

  const url = buildGoogleAuthUrl({
    config,
    state,
    nonce,
    codeChallenge: challenge,
    promptConsent,
  });

  logEvent("gcal_auth_start", { user_id: userId, prompt_consent: promptConsent });

  return jsonResponse({ ok: true, url }, 200, req);
});
