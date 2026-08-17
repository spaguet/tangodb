import {
  buildOAuthCallbackRedirect,
  byteaToUint8Array,
  defaultIntegrationsReturnUrl,
  encryptRefreshToken,
  exchangeAuthorizationCode,
  GoogleOAuthError,
  hashOAuthState,
  mergeGrantedScopes,
  loadGoogleOAuthConfig,
  uint8ArrayToByteaHex,
  validateGoogleIdToken,
} from "../_shared/googleOAuth.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

function redirectTo(url: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url },
  });
}

function safeRedirect(baseUrl: string, result: { ok: true } | { ok: false; reason: string }): Response {
  try {
    return redirectTo(buildOAuthCallbackRedirect(baseUrl, result));
  } catch {
    return new Response("OAuth callback error", { status: 400 });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const config = await loadGoogleOAuthConfig();
  const fallbackReturn = defaultIntegrationsReturnUrl() ?? "about:blank";
  if (!config) {
    return safeRedirect(fallbackReturn, { ok: false, reason: "service_unavailable" });
  }

  const url = new URL(req.url);
  const oauthError = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (oauthError) {
    logEvent("gcal_auth_callback_denied", { error: oauthError });
    return safeRedirect(fallbackReturn, { ok: false, reason: oauthError });
  }

  if (!code || !state) {
    return safeRedirect(fallbackReturn, { ok: false, reason: "missing_code_or_state" });
  }

  const stateHash = await hashOAuthState(state);
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: oauthState, error: consumeError } = await admin
    .from("google_oauth_states")
    .update({ consumed_at: nowIso })
    .eq("state_hash", stateHash)
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .select("user_id, oidc_nonce, pkce_verifier, return_url")
    .maybeSingle();

  if (consumeError || !oauthState) {
    logEvent("gcal_auth_callback_invalid_state", { code: consumeError?.code ?? "not_found" });
    return safeRedirect(fallbackReturn, { ok: false, reason: "invalid_state" });
  }

  const returnUrl = oauthState.return_url as string;

  try {
    const tokens = await exchangeAuthorizationCode(
      config,
      code,
      oauthState.pkce_verifier as string
    );

    const claims = await validateGoogleIdToken(
      config,
      tokens.id_token,
      oauthState.oidc_nonce as string
    );

    const { data: subjectOwner } = await admin
      .from("user_google_accounts")
      .select("id, user_id, encrypted_refresh_token, granted_scopes, status")
      .eq("google_subject", claims.sub)
      .maybeSingle();

    if (subjectOwner && subjectOwner.user_id !== oauthState.user_id) {
      logEvent("gcal_auth_subject_conflict", { google_subject: claims.sub });
      return safeRedirect(returnUrl, { ok: false, reason: "google_account_in_use" });
    }

    const { data: existingForUser } = await admin
      .from("user_google_accounts")
      .select("id, encrypted_refresh_token, granted_scopes, status")
      .eq("user_id", oauthState.user_id)
      .eq("google_subject", claims.sub)
      .maybeSingle();

    const priorStatus =
      existingForUser?.status ?? subjectOwner?.status ?? null;
    const requiresFreshRefreshToken =
      priorStatus === "revoked" || priorStatus === "error";

    let encryptedToken: Uint8Array | null = null;
    const refreshToken = tokens.refresh_token;
    if (refreshToken) {
      encryptedToken = await encryptRefreshToken(config.encryptionKey, refreshToken);
    } else if (!requiresFreshRefreshToken) {
      encryptedToken =
        byteaToUint8Array(existingForUser?.encrypted_refresh_token) ??
        byteaToUint8Array(subjectOwner?.encrypted_refresh_token);
    }

    if (!encryptedToken) {
      return safeRedirect(returnUrl, { ok: false, reason: "missing_refresh_token" });
    }

    const grantedScopes = mergeGrantedScopes(
      (existingForUser?.granted_scopes as string[] | null) ??
        (subjectOwner?.granted_scopes as string[] | null),
      tokens.scope
    );
    const accountId = existingForUser?.id ?? subjectOwner?.id;

    const row = {
      user_id: oauthState.user_id,
      google_subject: claims.sub,
      google_email: claims.email,
      encrypted_refresh_token: uint8ArrayToByteaHex(encryptedToken),
      granted_scopes: grantedScopes,
      status: "active",
      last_verified_at: nowIso,
      updated_at: nowIso,
    };

    let savedAccountId = accountId as string | undefined;

    if (accountId) {
      const { error: updateError } = await admin
        .from("user_google_accounts")
        .update(row)
        .eq("id", accountId);
      if (updateError) {
        throw updateError;
      }
    } else {
      const { data: inserted, error: insertError } = await admin
        .from("user_google_accounts")
        .insert(row)
        .select("id")
        .single();
      if (insertError) {
        if (insertError.code === "23505") {
          return safeRedirect(returnUrl, { ok: false, reason: "google_account_in_use" });
        }
        throw insertError;
      }
      savedAccountId = inserted.id as string;
    }

    if (savedAccountId) {
      const { data: bindings } = await admin
        .from("member_google_calendar_bindings")
        .select("organization_id, organization_member_id")
        .eq("google_account_id", savedAccountId)
        .eq("enabled", true);

      for (const binding of bindings ?? []) {
        const { error: reconcileError } = await admin.rpc("enqueue_calendar_sync", {
          p_organization_id: binding.organization_id,
          p_source_type: "personal_lesson",
          p_source_id: binding.organization_member_id,
          p_occurrence_date: null,
          p_operation: "reconcile_member",
        });
        if (reconcileError) {
          logEvent("gcal_auth_reconcile_enqueue_error", {
            google_account_id: savedAccountId,
            organization_member_id: binding.organization_member_id,
            message: reconcileError.message,
          });
        }
      }

      await admin
        .from("member_google_calendar_bindings")
        .update({
          last_error_code: null,
          last_error_at: null,
          updated_at: nowIso,
        })
        .eq("google_account_id", savedAccountId)
        .eq("enabled", true);
    }

    logEvent("gcal_auth_connected", {
      user_id: oauthState.user_id as string,
      google_email: claims.email,
      reconnected: requiresFreshRefreshToken,
    });

    return safeRedirect(returnUrl, { ok: true });
  } catch (err) {
    const reason = err instanceof GoogleOAuthError ? err.code : "callback_failed";
    logEvent("gcal_auth_callback_error", {
      reason,
      message: err instanceof Error ? err.message : "unknown",
    });
    return safeRedirect(returnUrl, { ok: false, reason });
  }
});
