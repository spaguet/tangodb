import { sendTransactionalEmail } from "../_shared/email.ts";
import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60_000;
const DEFAULT_DEVELOPER_EMAIL = "omowdance@gmail.com";

interface SubmitPurchaseRequestBody {
  organization_id?: string;
  payment_comment?: string;
  contact_email?: string;
  contact_telegram?: string;
}

function trimText(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
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
  if (!checkRateLimit(`purchase-request:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS)) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: SubmitPurchaseRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const organizationId = trimText(body.organization_id, 80);
  const paymentComment = trimText(body.payment_comment);
  const contactEmail = normalizeEmail(trimText(body.contact_email, 160));
  const contactTelegram = trimText(body.contact_telegram, 160);

  if (!organizationId) {
    return jsonResponse({ error: "organization_required" }, 400, req);
  }
  if (paymentComment.length < 20) {
    return jsonResponse({ error: "payment_comment_too_short" }, 400, req);
  }
  if (contactEmail && !isValidEmail(contactEmail)) {
    return jsonResponse({ error: "invalid_contact_email" }, 400, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const admin = createServiceClient();
  const { data: membership, error: membershipError } = await admin
    .from("organization_members")
    .select("role, is_active, organization:organizations(id, name, status)")
    .eq("organization_id", organizationId)
    .eq("user_id", userData.user.id)
    .maybeSingle();

  const org = Array.isArray(membership?.organization)
    ? membership?.organization[0]
    : membership?.organization;

  if (
    membershipError ||
    !membership ||
    !membership.is_active ||
    !["owner", "director"].includes(membership.role) ||
    !org
  ) {
    return jsonResponse({ error: "license_permission_required" }, 403, req);
  }

  const { data: paymentConfig } = await admin
    .from("platform_payment_methods")
    .select("config")
    .eq("id", 1)
    .maybeSingle();

  const developerEmailRaw =
    (paymentConfig?.config as { contacts?: { email?: string } } | null)?.contacts?.email ??
    DEFAULT_DEVELOPER_EMAIL;
  const developerEmail = isValidEmail(developerEmailRaw) ? developerEmailRaw : DEFAULT_DEVELOPER_EMAIL;

  const requesterEmail = userData.user.email ?? (contactEmail || null);
  const { data: requestRow, error: insertError } = await admin
    .from("platform_purchase_requests")
    .insert({
      organization_id: organizationId,
      requester_user_id: userData.user.id,
      requester_email: requesterEmail,
      organization_name: org.name,
      contact_email: contactEmail || requesterEmail,
      contact_telegram: contactTelegram || null,
      payment_comment: paymentComment,
      status: "new",
    })
    .select("id, created_at")
    .single();

  if (insertError || !requestRow) {
    logEvent("purchase_request_insert_failed", { code: insertError?.code ?? "unknown" });
    return jsonResponse({ error: "request_save_failed" }, 500, req);
  }

  const emailSent = await sendTransactionalEmail({
    to: developerEmail,
    subject: `TangoDB: заявка на полную версию — ${org.name}`,
    text: [
      "Новая заявка на покупку полной версии TangoDB.",
      "",
      `Request ID: ${requestRow.id}`,
      `Organization: ${org.name} (${organizationId})`,
      `Requester email: ${requesterEmail ?? "not provided"}`,
      `Contact email: ${contactEmail || requesterEmail || "not provided"}`,
      `Telegram: ${contactTelegram || "not provided"}`,
      "",
      "Комментарий пользователя:",
      paymentComment,
      "",
      "Проверьте поступление средств и активируйте доступ в Dev Console → Inbox.",
    ].join("\n"),
  });

  if (emailSent) {
    await admin
      .from("platform_purchase_requests")
      .update({ email_sent: true, updated_at: new Date().toISOString() })
      .eq("id", requestRow.id);
  }

  await admin.from("platform_audit_log").insert({
    actor_user_id: userData.user.id,
    action: "purchase_request.submit",
    target_type: "platform_purchase_request",
    target_id: requestRow.id,
    metadata: {
      organization_id: organizationId,
      email_sent: emailSent,
      requester_domain: requesterEmail?.split("@")[1] ?? null,
    },
  });

  return jsonResponse({ ok: true, id: requestRow.id, email_sent: emailSent }, 200, req);
});
