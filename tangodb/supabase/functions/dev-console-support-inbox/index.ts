import { isDeveloperVerified } from "../_shared/devAuth.ts";
import { getClientIp, handleOptions, jsonResponse } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 40;
const RATE_WINDOW_MS = 15 * 60_000;

type SupportInboxAction = "list" | "open" | "close";

interface SupportInboxBody {
  action?: SupportInboxAction;
  ticket_id?: string;
  status?: string;
  kind?: string;
  close_reason?: string;
  close_note?: string;
}

function asString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function requireDeveloper(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return { error: jsonResponse({ error: "Unauthorized" }, 401, req) };

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !(await isDeveloperVerified(userData.user))) {
    return { error: jsonResponse({ error: "developer_access_required" }, 403, req) };
  }

  return { user: userData.user };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`dev-console-support-inbox:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const auth = await requireDeveloper(req);
  if (auth.error) return auth.error;

  let body: SupportInboxBody;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = body.action ?? "list";
  const admin = createServiceClient();

  if (action === "list") {
    const status = asString(body.status, 40);
    const kind = asString(body.kind, 40);

    let query = admin
      .from("platform_support_tickets")
      .select(
        "id, ticket_kind, status, email, contact_telegram, organization_id, organization_name, locale, message, page_path, close_reason, close_note, created_at, updated_at, opened_at, closed_at"
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (status && status !== "all") query = query.eq("status", status);
    if (kind && kind !== "all") query = query.eq("ticket_kind", kind);

    const { data, error } = await query;
    if (error) {
      logEvent("dev_console_support_inbox_list_failed", { code: error.code ?? "unknown" });
      return jsonResponse({ error: "inbox_list_failed" }, 500, req);
    }

    return jsonResponse({ ok: true, tickets: data ?? [] }, 200, req);
  }

  const ticketId = asString(body.ticket_id, 80);
  if (!ticketId) {
    return jsonResponse({ error: "ticket_id_required" }, 400, req);
  }

  if (action === "open" || action === "close") {
    const closeReason = asString(body.close_reason, 500);
    const closeNote = asString(body.close_note, 2000);

    const { data, error } = await admin.rpc("dev_console_update_support_ticket", {
      p_ticket_id: ticketId,
      p_actor_user_id: auth.user!.id,
      p_status: action === "open" ? "open" : "closed",
      p_close_reason: action === "close" ? closeReason : null,
      p_close_note: action === "close" ? closeNote : null,
    });

    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("close_reason_required")) {
        return jsonResponse({ error: "close_reason_required" }, 400, req);
      }
      if (msg.includes("support_ticket_not_found")) {
        return jsonResponse({ error: "ticket_not_found" }, 404, req);
      }
      logEvent("dev_console_support_update_failed", { code: error.code ?? "unknown" });
      return jsonResponse({ error: "update_failed" }, 500, req);
    }

    return jsonResponse({ ok: true, result: data }, 200, req);
  }

  return jsonResponse({ error: "unknown_action" }, 400, req);
});
