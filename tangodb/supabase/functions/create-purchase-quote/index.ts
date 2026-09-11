import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { resolvePaymentQuote, type PlatformPaymentSku } from "../_shared/paymentQuote.ts";
import { loadLicensePurchaseOrg } from "../_shared/purchaseMembership.ts";
import {
  assertQuoteCreationAllowed,
  computeQuoteExpiresAt,
  parsePurchaseQuoteSku,
} from "../_shared/purchaseQuotePolicy.ts";
import { isRenterActor, renterActorForbidden } from "../_shared/staffAuth.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;

function trimText(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

interface CreateQuoteBody {
  organization_id?: string;
  sku?: string;
  method_code?: string;
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
  if (!(await checkRateLimit(`purchase-quote:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let body: CreateQuoteBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const organizationId = trimText(body.organization_id, 80);
  const sku = parsePurchaseQuoteSku(trimText(body.sku, 40));
  const methodCode = trimText(body.method_code, 120);

  if (!organizationId) {
    return jsonResponse({ error: "organization_required" }, 400, req);
  }
  if (!sku) {
    return jsonResponse({ error: "invalid_sku" }, 400, req);
  }
  if (!methodCode) {
    return jsonResponse({ error: "method_code_required" }, 400, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }
  if (isRenterActor(userData.user)) {
    return renterActorForbidden(req);
  }

  if (
    !(await checkRateLimit(
      `purchase-quote:user:${userData.user.id}`,
      RATE_LIMIT,
      RATE_WINDOW_MS
    ))
  ) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const admin = createServiceClient();
  const membership = await loadLicensePurchaseOrg(admin, organizationId, userData.user.id);
  if (!membership.ok) {
    return jsonResponse({ error: membership.code }, membership.httpStatus, req);
  }

  const nowMs = Date.now();
  const purgeCheck = assertQuoteCreationAllowed(nowMs, membership.org.data_purge_at);
  if (!purgeCheck.ok) {
    return jsonResponse({ error: purgeCheck.code }, 403, req);
  }

  if (sku === "crm_subscription") {
    const { data: hasLifetime, error: lifetimeError } = await admin.rpc(
      "organization_has_lifetime_license",
      { p_org_id: organizationId }
    );
    if (lifetimeError) {
      logEvent("purchase_quote_lifetime_check_failed", { code: lifetimeError.code ?? "unknown" });
      return jsonResponse({ error: "quote_unavailable" }, 500, req);
    }
    if (hasLifetime === true) {
      return jsonResponse({ error: "lifetime_org_monthly_forbidden" }, 403, req);
    }
  }

  const { data: paymentRow, error: configError } = await admin
    .from("platform_payment_methods")
    .select("config")
    .eq("id", 1)
    .maybeSingle();

  if (configError || !paymentRow?.config) {
    return jsonResponse({ error: "payment_config_unavailable" }, 500, req);
  }

  const resolved = resolvePaymentQuote(paymentRow.config, sku as PlatformPaymentSku, methodCode);
  if (!resolved.ok) {
    return jsonResponse({ error: resolved.code }, 400, req);
  }

  const expiresAt = computeQuoteExpiresAt(nowMs, membership.org.data_purge_at);
  if (Date.parse(expiresAt) <= nowMs) {
    return jsonResponse({ error: "purge_window_too_short" }, 403, req);
  }

  void admin.rpc("cleanup_expired_platform_purchase_quotes", { p_batch_size: 50 });

  const { data: quoteRow, error: insertError } = await admin
    .from("platform_purchase_quotes")
    .insert({
      organization_id: organizationId,
      requester_user_id: userData.user.id,
      sku: resolved.sku,
      method_code: resolved.methodCode,
      amount: resolved.amount,
      currency: resolved.currency,
      pricing_revision: resolved.pricingRevision,
      payment_details_snapshot: resolved.paymentDetails,
      qr_sha256: resolved.qrSha256,
      expires_at: expiresAt,
    })
    .select("id, expires_at")
    .single();

  if (insertError || !quoteRow) {
    logEvent("purchase_quote_insert_failed", { code: insertError?.code ?? "unknown" });
    return jsonResponse({ error: "quote_create_failed" }, 500, req);
  }

  return jsonResponse(
    {
      ok: true,
      quote_id: quoteRow.id,
      sku: resolved.sku,
      method_code: resolved.methodCode,
      amount: resolved.amount,
      currency: resolved.currency,
      pricing_revision: resolved.pricingRevision,
      payment_details: resolved.paymentDetails,
      expires_at: quoteRow.expires_at,
    },
    200,
    req
  );
});
