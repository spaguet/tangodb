import { sendTransactionalEmail } from "../_shared/email.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 15 * 60_000;

type RemindBody = {
  organization_member_id?: string;
};

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
  if (!checkRateLimit(`gcal-remind-connect:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: RemindBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const organizationMemberId = (body.organization_member_id ?? "").trim();
  if (!organizationMemberId) {
    return jsonResponse({ error: "organization_member_id required" }, 400, req);
  }

  const admin = createServiceClient();

  const { data: callerMember, error: callerError } = await userClient
    .from("organization_members")
    .select("organization_id, role, is_active")
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (callerError || !callerMember) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const callerRole = callerMember.role as string;
  if (callerRole !== "owner" && callerRole !== "director") {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const organizationId = callerMember.organization_id as string;

  const { data: targetMember, error: targetError } = await admin
    .from("organization_members")
    .select(
      "id, organization_id, display_name, first_name, last_name, contact_email, user_id, is_active"
    )
    .eq("id", organizationMemberId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (targetError || !targetMember || !targetMember.is_active) {
    return jsonResponse({ error: "member_not_found" }, 404, req);
  }

  const { data: binding } = await admin
    .from("member_google_calendar_bindings")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("organization_member_id", organizationMemberId)
    .eq("enabled", true)
    .maybeSingle();

  if (binding) {
    return jsonResponse({ error: "already_connected" }, 409, req);
  }

  let recipientEmail = (targetMember.contact_email as string | null)?.trim() ?? "";
  if (!recipientEmail) {
    const { data: authUser, error: authLookupError } = await admin.auth.admin.getUserById(
      targetMember.user_id as string
    );
    if (!authLookupError && authUser?.user?.email) {
      recipientEmail = authUser.user.email.trim();
    }
  }

  if (!recipientEmail) {
    return jsonResponse({ error: "member_email_missing" }, 422, req);
  }

  const { data: orgRow } = await admin
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  const orgName = (orgRow?.name as string | undefined)?.trim() || "TangoDB";
  const siteUrl = (Deno.env.get("SITE_URL") ?? "https://tangodb.vercel.app").replace(/\/$/, "");
  const integrationsUrl = `${siteUrl}/settings/integrations`;

  const displayName =
    (targetMember.display_name as string | null)?.trim() ||
    [targetMember.first_name, targetMember.last_name].filter(Boolean).join(" ").trim() ||
    "коллега";

  const subject = `${orgName} — подключите Google Calendar в TangoDB`;
  const text =
    `Здравствуйте, ${displayName}!\n\n` +
    `Администратор организации «${orgName}» просит подключить Google Calendar в TangoDB, ` +
    `чтобы уроки из CRM автоматически попадали в ваш рабочий календарь.\n\n` +
    `Откройте настройки интеграций: ${integrationsUrl}\n\n` +
    `После подключения выберите или создайте календарь TangoDB — личные события останутся отдельно.\n`;

  const emailSent = await sendTransactionalEmail({
    to: recipientEmail,
    subject,
    text,
  });

  logEvent("gcal_remind_connect", {
    organization_id: organizationId,
    target_member_id: organizationMemberId,
    email_sent: emailSent,
  });

  if (!emailSent) {
    return jsonResponse({ error: "email_not_sent" }, 502, req);
  }

  return jsonResponse({ ok: true }, 200, req);
});
