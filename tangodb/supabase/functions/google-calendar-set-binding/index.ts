import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60_000;

type SetBindingBody = {
  organization_member_id?: string;
  google_account_id?: string;
  calendar_id?: string;
  calendar_name?: string;
  timezone?: string;
  delete_old_events?: boolean;
};

async function writeAuditLog(
  admin: ReturnType<typeof createServiceClient>,
  params: {
    organizationId: string;
    rowId: string;
    userId: string;
    action: string;
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    organization_id: params.organizationId,
    table_name: "member_google_calendar_bindings",
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
  if (!checkRateLimit(`gcal-set-binding:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: SetBindingBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const memberId = (body.organization_member_id ?? "").trim();
  const googleAccountId = (body.google_account_id ?? "").trim();
  const calendarId = (body.calendar_id ?? "").trim();
  const calendarName = (body.calendar_name ?? "").trim();
  const timezone = (body.timezone ?? "").trim();
  const deleteOldEvents = body.delete_old_events === true;

  if (!memberId) {
    return jsonResponse({ error: "organization_member_id required" }, 400, req);
  }
  if (!googleAccountId) {
    return jsonResponse({ error: "google_account_id required" }, 400, req);
  }
  if (!calendarId) {
    return jsonResponse({ error: "calendar_id required" }, 400, req);
  }
  if (!calendarName) {
    return jsonResponse({ error: "calendar_name required" }, 400, req);
  }
  if (!timezone) {
    return jsonResponse({ error: "timezone required" }, 400, req);
  }

  const userId = userData.user.id;
  const admin = createServiceClient();
  const nowIso = new Date().toISOString();

  const { data: member } = await admin
    .from("organization_members")
    .select("id, organization_id, user_id, is_active")
    .eq("id", memberId)
    .maybeSingle();

  if (!member || member.user_id !== userId) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  if (!member.is_active) {
    return jsonResponse({ error: "member_not_active" }, 403, req);
  }

  const organizationId = member.organization_id as string;

  const { data: account } = await admin
    .from("user_google_accounts")
    .select("id, user_id, status")
    .eq("id", googleAccountId)
    .maybeSingle();

  if (!account || account.user_id !== userId) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  if (account.status === "revoked") {
    return jsonResponse({ error: "token_revoked", code: "token_revoked" }, 401, req);
  }

  const { data: activeBinding } = await admin
    .from("member_google_calendar_bindings")
    .select("id, calendar_id, google_account_id")
    .eq("organization_id", organizationId)
    .eq("organization_member_id", memberId)
    .eq("enabled", true)
    .maybeSingle();

  if (
    activeBinding &&
    activeBinding.calendar_id === calendarId &&
    activeBinding.google_account_id === googleAccountId
  ) {
    return jsonResponse({
      ok: true,
      binding_id: activeBinding.id,
      already_configured: true,
    }, 200, req);
  }

  if (activeBinding) {
    const { error: disableError } = await admin
      .from("member_google_calendar_bindings")
      .update({
        enabled: false,
        disabled_at: nowIso,
        cleanup_pending: deleteOldEvents,
        updated_at: nowIso,
      })
      .eq("id", activeBinding.id);

    if (disableError) {
      return jsonResponse({ error: "Failed to disable previous binding" }, 500, req);
    }

    await writeAuditLog(admin, {
      organizationId,
      rowId: activeBinding.id as string,
      userId,
      action: "google_calendar_change_calendar",
      metadata: {
        previous_calendar_id: activeBinding.calendar_id,
        delete_old_events: deleteOldEvents,
      },
    });
  }

  const { data: newBinding, error: insertError } = await admin
    .from("member_google_calendar_bindings")
    .insert({
      organization_id: organizationId,
      organization_member_id: memberId,
      google_account_id: googleAccountId,
      calendar_id: calendarId,
      calendar_name: calendarName,
      timezone,
      enabled: true,
      sync_group: false,
      sync_personal: true,
      sync_events: false,
      privacy_mode: "initials",
      cleanup_pending: false,
      disabled_at: null,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (insertError || !newBinding) {
    logEvent("gcal_set_binding_error", {
      user_id: userId,
      code: insertError?.code ?? "insert_failed",
    });
    return jsonResponse({ error: "Failed to save binding" }, 500, req);
  }

  await writeAuditLog(admin, {
    organizationId,
    rowId: newBinding.id as string,
    userId,
    action: "google_calendar_set_binding",
    metadata: {
      google_account_id: googleAccountId,
      calendar_id: calendarId,
      calendar_name: calendarName,
      timezone,
      replaced_binding_id: activeBinding?.id ?? null,
      delete_old_events: deleteOldEvents,
    },
  });

  logEvent("gcal_binding_saved", {
    user_id: userId,
    organization_member_id: memberId,
    binding_id: newBinding.id as string,
    calendar_id: calendarId,
  });

  // Outbox enqueue for old-calendar cleanup — Prompt 5 (calendar_sync_outbox).
  return jsonResponse({
    ok: true,
    binding_id: newBinding.id,
    cleanup_pending_previous: deleteOldEvents && activeBinding != null,
  }, 200, req);
});
