import { sendTransactionalEmail } from "../_shared/email.ts";
import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { isRenterActor, renterActorForbidden } from "../_shared/staffAuth.ts";
import { PURCHASE_REQUEST_COMMENT_MIN_LENGTH } from "../_shared/purchaseRequest.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60_000;

function resolveDeveloperNotifyEmail(configEmail: unknown): string | null {
  const fromConfig = typeof configEmail === "string" ? configEmail.trim() : "";
  if (isValidEmail(fromConfig)) return fromConfig;
  const fromEnv = (Deno.env.get("DEVELOPER_NOTIFY_EMAIL") ?? "").trim();
  if (isValidEmail(fromEnv)) return fromEnv;
  return null;
}

type PurchaseRequestKind = "crm_license" | "renter_miniapp_addon";

interface SubmitPurchaseRequestBody {
  organization_id?: string;
  payment_comment?: string;
  contact_email?: string;
  contact_telegram?: string;
  request_kind?: PurchaseRequestKind;
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
  if (!(await checkRateLimit(`purchase-request:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
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
  const requestKindRaw = trimText(body.request_kind, 40);
  const requestKind: PurchaseRequestKind =
    requestKindRaw === "renter_miniapp_addon" ? "renter_miniapp_addon" : "crm_license";

  if (!organizationId) {
    return jsonResponse({ error: "organization_required" }, 400, req);
  }
  if (requestKindRaw && requestKindRaw !== requestKind) {
    return jsonResponse({ error: "invalid_request_kind" }, 400, req);
  }
  if (paymentComment.length < PURCHASE_REQUEST_COMMENT_MIN_LENGTH) {
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
  if (isRenterActor(userData.user)) {
    return renterActorForbidden(req);
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

  if (requestKind === "renter_miniapp_addon") {
    return jsonResponse({ error: "addon_purchase_disabled" }, 403, req);
  }

  const { data: paymentConfig } = await admin
    .from("platform_payment_methods")
    .select("config")
    .eq("id", 1)
    .maybeSingle();

  const developerEmail = resolveDeveloperNotifyEmail(
    (paymentConfig?.config as { contacts?: { email?: string } } | null)?.contacts?.email
  );
  const addonPriceRaw = (paymentConfig?.config as {
    renterMiniappAddon?: { amount?: string; currency?: string };
  } | null)?.renterMiniappAddon;
  const addonPriceLabel = [addonPriceRaw?.amount, addonPriceRaw?.currency]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");

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
      request_kind: requestKind,
      status: "new",
    })
    .select("id, created_at")
    .single();

  if (insertError || !requestRow) {
    logEvent("purchase_request_insert_failed", { code: insertError?.code ?? "unknown" });
    return jsonResponse({ error: "request_save_failed" }, 500, req);
  }

  const isAddonRequest = requestKind === "renter_miniapp_addon";
  let emailSent = false;
  if (developerEmail) {
    emailSent = await sendTransactionalEmail({
      to: developerEmail,
      subject: isAddonRequest
        ? `TangoDB: заявка на модуль Mini App — ${org.name}`
        : `TangoDB: заявка на полную версию — ${org.name}`,
      text: isAddonRequest
        ? [
            "Новая заявка на оплату модуля Mini App (аренда зала, ежемесячно).",
            "",
            `Request ID: ${requestRow.id}`,
            `Kind: renter_miniapp_addon`,
            `Configured monthly price: ${addonPriceLabel || "not configured"}`,
            `Organization: ${org.name} (${organizationId})`,
            `Requester email: ${requesterEmail ?? "not provided"}`,
            `Contact email: ${contactEmail || requesterEmail || "not provided"}`,
            `Telegram: ${contactTelegram || "not provided"}`,
            "",
            "Комментарий пользователя:",
            paymentComment,
            "",
            "Проверьте поступление средств и активируйте период add-on в Dev Console → Inbox.",
            "Не активировать lifetime CRM — только organization_addons.",
          ].join("\n")
        : [
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
  } else {
    logEvent("purchase_request_notify_email_missing", { request_id: requestRow.id });
  }

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
      request_kind: requestKind,
      email_sent: emailSent,
      requester_domain: requesterEmail?.split("@")[1] ?? null,
    },
  });

  return jsonResponse({ ok: true, id: requestRow.id, email_sent: emailSent }, 200, req);
});
