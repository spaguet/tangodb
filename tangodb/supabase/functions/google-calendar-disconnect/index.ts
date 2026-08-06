import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import {
  byteaToUint8Array,
  decryptRefreshToken,
  loadGoogleOAuthConfig,
  revokeGoogleToken,
} from "../_shared/googleOAuth.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";
import {
  GoogleCalendarApiError,
  loadGoogleOAuthConfigOrThrow,
} from "../_shared/googleCalendarClient.ts";
import { stopWatchForBinding } from "../_shared/googleCalendarWatch.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60_000;

type DisconnectBody = {
  organization_member_id?: string;
  organization_binding_id?: string;
  delete_future_events?: boolean;
  revoke_account?: boolean;
  google_account_id?: string;
};

async function writeAuditLog(
  admin: ReturnType<typeof createServiceClient>,
  params: {
    organizationId: string;
    tableName: string;
    rowId: string;
    userId: string;
    action: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    organization_id: params.organizationId,
    table_name: params.tableName,
    operation: "UPDATE",
    row_id: params.rowId,
    new_data: { action: params.action, ...params.metadata },
    changed_by: params.userId,
  });
  if (error) {
    logEvent("gcal_audit_log_error", { code: error.code ?? "insert_failed" });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`gcal-disconnect:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: DisconnectBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const userId = userData.user.id;
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();
  const deleteFuture = body.delete_future_events === true;
  const revokeAccount = body.revoke_account === true;

  if (revokeAccount) {
    const googleAccountId = (body.google_account_id ?? "").trim();
    if (!googleAccountId) {
      return jsonResponse({ error: "google_account_id required" }, 400, req);
    }

    const { data: account } = await admin
      .from("user_google_accounts")
      .select("id, user_id, encrypted_refresh_token, google_email")
      .eq("id", googleAccountId)
      .maybeSingle();

    if (!account || account.user_id !== userId) {
      return jsonResponse({ error: "Forbidden" }, 403, req);
    }

    const config = await loadGoogleOAuthConfig();
    const tokenBytes = byteaToUint8Array(account.encrypted_refresh_token);
    if (tokenBytes && config) {
      try {
        const refreshToken = await decryptRefreshToken(config.encryptionKey, tokenBytes);
        await revokeGoogleToken(refreshToken);
      } catch (err) {
        logEvent("gcal_revoke_token_error", {
          account_id: googleAccountId,
          message: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    const { data: memberBindings } = await admin
      .from("member_google_calendar_bindings")
      .select("id, organization_id")
      .eq("google_account_id", googleAccountId)
      .eq("enabled", true);

    for (const binding of memberBindings ?? []) {
      try {
        const oauthConfig = await loadGoogleOAuthConfigOrThrow();
        await stopWatchForBinding(admin, oauthConfig, "member", binding.id as string);
      } catch (err) {
        logEvent("gcal_watch_stop_on_revoke_error", {
          binding_id: binding.id,
          message: err instanceof Error ? err.message : "unknown",
        });
      }

      await admin
        .from("member_google_calendar_bindings")
        .update({
          enabled: false,
          disabled_at: nowIso,
          cleanup_pending: deleteFuture,
          updated_at: nowIso,
        })
        .eq("id", binding.id);

      await writeAuditLog(admin, {
        organizationId: binding.organization_id as string,
        tableName: "member_google_calendar_bindings",
        rowId: binding.id as string,
        userId,
        action: "google_calendar_disconnect_account",
        metadata: { google_account_id: googleAccountId, delete_future_events: deleteFuture },
      });
    }

    const { data: orgBindings } = await admin
      .from("organization_google_calendar_bindings")
      .select("id, organization_id")
      .eq("google_account_id", googleAccountId)
      .eq("enabled", true);

    for (const binding of orgBindings ?? []) {
      try {
        const oauthConfig = await loadGoogleOAuthConfigOrThrow();
        await stopWatchForBinding(admin, oauthConfig, "organization", binding.id as string);
      } catch (err) {
        logEvent("gcal_watch_stop_on_revoke_error", {
          binding_id: binding.id,
          message: err instanceof Error ? err.message : "unknown",
        });
      }

      await admin
        .from("organization_google_calendar_bindings")
        .update({
          enabled: false,
          disabled_at: nowIso,
          cleanup_pending: deleteFuture,
          updated_at: nowIso,
        })
        .eq("id", binding.id);

      await writeAuditLog(admin, {
        organizationId: binding.organization_id as string,
        tableName: "organization_google_calendar_bindings",
        rowId: binding.id as string,
        userId,
        action: "google_calendar_disconnect_account",
        metadata: { google_account_id: googleAccountId, delete_future_events: deleteFuture },
      });
    }

    await admin
      .from("user_google_accounts")
      .update({
        status: "revoked",
        encrypted_refresh_token: null,
        updated_at: nowIso,
      })
      .eq("id", googleAccountId);

    logEvent("gcal_account_revoked", { user_id: userId, google_account_id: googleAccountId });

    return jsonResponse({ ok: true, revoked: true }, 200, req);
  }

  const orgBindingId = (body.organization_binding_id ?? "").trim();
  const memberId = (body.organization_member_id ?? "").trim();

  if (!orgBindingId && !memberId) {
    return jsonResponse({ error: "organization_member_id or organization_binding_id required" }, 400, req);
  }

  if (orgBindingId) {
    const { data: binding } = await admin
      .from("organization_google_calendar_bindings")
      .select("id, organization_id, configured_by_member_id, enabled")
      .eq("id", orgBindingId)
      .maybeSingle();

    if (!binding) {
      return jsonResponse({ error: "Binding not found" }, 404, req);
    }

    const { data: configurator } = await admin
      .from("organization_members")
      .select("user_id, role")
      .eq("id", binding.configured_by_member_id)
      .eq("organization_id", binding.organization_id)
      .maybeSingle();

    const { data: callerMember } = await admin
      .from("organization_members")
      .select("role")
      .eq("organization_id", binding.organization_id)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    const isConfigurator = configurator?.user_id === userId;
    const isOwnerDirector =
      callerMember?.role === "owner" || callerMember?.role === "director";

    if (!isConfigurator && !isOwnerDirector) {
      return jsonResponse({ error: "Forbidden" }, 403, req);
    }

    if (!binding.enabled) {
      return jsonResponse({ ok: true, already_disconnected: true }, 200, req);
    }

    const { error: updateError } = await admin
      .from("organization_google_calendar_bindings")
      .update({
        enabled: false,
        disabled_at: nowIso,
        cleanup_pending: deleteFuture,
        updated_at: nowIso,
      })
      .eq("id", orgBindingId);

    if (updateError) {
      return jsonResponse({ error: "Disconnect failed" }, 500, req);
    }

    try {
      const oauthConfig = await loadGoogleOAuthConfigOrThrow();
      await stopWatchForBinding(admin, oauthConfig, "organization", orgBindingId);
    } catch (err) {
      logEvent("gcal_watch_stop_on_disconnect_error", {
        binding_id: orgBindingId,
        message: err instanceof Error ? err.message : "unknown",
      });
    }

    await writeAuditLog(admin, {
      organizationId: binding.organization_id as string,
      tableName: "organization_google_calendar_bindings",
      rowId: orgBindingId,
      userId,
      action: "google_calendar_disconnect",
      metadata: { delete_future_events: deleteFuture },
    });

    logEvent("gcal_org_binding_disconnected", {
      user_id: userId,
      organization_binding_id: orgBindingId,
      cleanup_pending: deleteFuture,
    });

    return jsonResponse({ ok: true, cleanup_pending: deleteFuture }, 200, req);
  }

  const { data: member } = await admin
    .from("organization_members")
    .select("id, organization_id, user_id")
    .eq("id", memberId)
    .maybeSingle();

  if (!member || member.user_id !== userId) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const { data: binding } = await admin
    .from("member_google_calendar_bindings")
    .select("id, enabled")
    .eq("organization_member_id", memberId)
    .eq("organization_id", member.organization_id)
    .eq("enabled", true)
    .maybeSingle();

  if (!binding) {
    return jsonResponse({ ok: true, already_disconnected: true }, 200, req);
  }

  const { error: updateError } = await admin
    .from("member_google_calendar_bindings")
    .update({
      enabled: false,
      disabled_at: nowIso,
      cleanup_pending: deleteFuture,
      updated_at: nowIso,
    })
    .eq("id", binding.id);

  if (updateError) {
    return jsonResponse({ error: "Disconnect failed" }, 500, req);
  }

  try {
    const oauthConfig = await loadGoogleOAuthConfigOrThrow();
    await stopWatchForBinding(admin, oauthConfig, "member", binding.id as string);
  } catch (err) {
    logEvent("gcal_watch_stop_on_disconnect_error", {
      binding_id: binding.id,
      message: err instanceof Error ? err.message : "unknown",
    });
  }

  await writeAuditLog(admin, {
    organizationId: member.organization_id as string,
    tableName: "member_google_calendar_bindings",
    rowId: binding.id as string,
    userId,
    action: "google_calendar_disconnect",
    metadata: { delete_future_events: deleteFuture },
  });

  logEvent("gcal_member_binding_disconnected", {
    user_id: userId,
    organization_member_id: memberId,
    cleanup_pending: deleteFuture,
  });

  // Outbox enqueue for future-event cleanup — Prompt 5 (calendar_sync_outbox).
  return jsonResponse({ ok: true, cleanup_pending: deleteFuture }, 200, req);
});
