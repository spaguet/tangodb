import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { hmacRateLimitKey } from "../_shared/rateLimitKey.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { isRenterActor, renterActorForbidden } from "../_shared/staffAuth.ts";
import { loadActiveStaffMember } from "../_shared/supportTicketMembership.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";
import { verifyTurnstileToken } from "../_shared/turnstile.ts";

const GUEST_KINDS = new Set(["login_help", "forgot_password"]);
const AUTH_KINDS = new Set(["license_help", "other"]);

const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 15 * 60_000;

const NEUTRAL_OK = { ok: true, submitted: true };

interface SubmitSupportBody {
  client_request_id?: string;
  ticket_kind?: string;
  email?: string;
  contact_telegram?: string;
  message?: string;
  page_path?: string;
  locale?: string;
  organization_id?: string;
  turnstile_token?: string;
}

function trimText(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const clientIp = getClientIp(req);
  const ipBucket = await hmacRateLimitKey("support-ticket:ip", clientIp);
  if (!(await checkRateLimit(ipBucket, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse(NEUTRAL_OK, 200, req);
  }

  let body: SubmitSupportBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const kind = trimText(body.ticket_kind, 40);
  const pagePath = trimText(body.page_path, 120);
  const message = trimText(body.message, 4000);
  const clientRequestId = trimText(body.client_request_id, 80);
  const contactTelegram = trimText(body.contact_telegram, 160);
  const locale = trimText(body.locale, 16);
  const email = normalizeEmail(trimText(body.email, 160));

  if (!clientRequestId || !isUuid(clientRequestId)) {
    return jsonResponse({ error: "client_request_id_required" }, 400, req);
  }
  if (!GUEST_KINDS.has(kind) && !AUTH_KINDS.has(kind)) {
    return jsonResponse({ error: "invalid_ticket_kind" }, 400, req);
  }
  if (message.length < 3) {
    return jsonResponse({ error: "message_too_short" }, 400, req);
  }

  const authHeader = req.headers.get("Authorization");
  const hasBearer = authHeader?.startsWith("Bearer ") ?? false;

  if (GUEST_KINDS.has(kind)) {
    if (hasBearer) {
      return jsonResponse({ error: "invalid_ticket_kind" }, 400, req);
    }
    if (!isValidEmail(email)) {
      return jsonResponse({ error: "invalid_email" }, 400, req);
    }

    const emailBucket = await hmacRateLimitKey("support-ticket:email", email);
    if (!(await checkRateLimit(emailBucket, RATE_LIMIT, RATE_WINDOW_MS))) {
      return jsonResponse(NEUTRAL_OK, 200, req);
    }

    const turnstile = await verifyTurnstileToken(body.turnstile_token ?? "", clientIp);
    if (!turnstile.ok) {
      logEvent("support_ticket_turnstile_rejected", { reason: turnstile.error ?? "unknown" });
      return jsonResponse({ error: "captcha_failed" }, 400, req);
    }

    const admin = createServiceClient();
    const { data, error } = await admin.rpc("submit_platform_support_ticket", {
      p_client_request_id: clientRequestId,
      p_ticket_kind: kind,
      p_email: email,
      p_contact_telegram: contactTelegram,
      p_message: message,
      p_page_path: pagePath,
      p_locale: locale,
      p_user_id: null,
      p_organization_id: null,
      p_organization_name: null,
    });

    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("kind_page_mismatch") || msg.includes("invalid_ticket_kind")) {
        return jsonResponse({ error: "invalid_request" }, 400, req);
      }
      logEvent("support_ticket_submit_failed", { code: error.code ?? "unknown" });
      return jsonResponse(NEUTRAL_OK, 200, req);
    }

    if (data?.accepted === true) {
      return jsonResponse(NEUTRAL_OK, 200, req);
    }
    return jsonResponse(NEUTRAL_OK, 200, req);
  }

  if (!hasBearer) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const userClient = createUserClient(authHeader!);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }
  if (isRenterActor(userData.user)) {
    return renterActorForbidden(req);
  }

  const organizationId = trimText(body.organization_id, 80);
  if (!organizationId || !isUuid(organizationId)) {
    return jsonResponse({ error: "organization_required" }, 400, req);
  }

  const admin = createServiceClient();
  const member = await loadActiveStaffMember(admin, organizationId, userData.user.id);
  if (!member.ok) {
    return jsonResponse({ error: member.code }, member.httpStatus, req);
  }

  const contactEmail = isValidEmail(email) ? email : normalizeEmail(userData.user.email ?? "");

  const { data, error } = await admin.rpc("submit_platform_support_ticket", {
    p_client_request_id: clientRequestId,
    p_ticket_kind: kind,
    p_email: contactEmail,
    p_contact_telegram: contactTelegram,
    p_message: message,
    p_page_path: pagePath,
    p_locale: locale,
    p_user_id: userData.user.id,
    p_organization_id: member.org.id,
    p_organization_name: member.org.name,
  });

  if (error) {
    const msg = (error.message ?? "").toLowerCase();
    if (msg.includes("kind_page_mismatch")) {
      return jsonResponse({ error: "invalid_request" }, 400, req);
    }
    logEvent("support_ticket_submit_failed", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "submit_failed" }, 500, req);
  }

  if (data?.accepted === true) {
    return jsonResponse({ ok: true, submitted: true }, 200, req);
  }
  return jsonResponse({ ok: true, submitted: true }, 200, req);
});
