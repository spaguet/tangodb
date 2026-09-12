import {
  getClientIp,
  handleOptions,
  isValidEmail,
  jsonResponse,
  normalizeEmail,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { loadLicensePurchaseOrg } from "../_shared/purchaseMembership.ts";
import { isUuid } from "../_shared/purchaseQuotePolicy.ts";
import { PURCHASE_REQUEST_COMMENT_MIN_LENGTH } from "../_shared/purchaseRequest.ts";
import { isRenterActor, renterActorForbidden } from "../_shared/staffAuth.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 15 * 60_000;

interface SubmitPurchaseRequestBody {
  organization_id?: string;
  payment_comment?: string;
  contact_email?: string;
  contact_telegram?: string;
  quote_id?: string;
  client_request_id?: string;
  request_kind?: string;
  payment_method_code?: string;
  amount?: string;
  currency?: string;
}

function trimText(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function mapSubmitRpcError(message: string): { status: number; code: string } {
  const m = message.toLowerCase();
  if (m.includes("quote_forbidden")) return { status: 403, code: "quote_forbidden" };
  if (m.includes("lifetime_org_monthly_forbidden")) {
    return { status: 403, code: "lifetime_org_monthly_forbidden" };
  }
  if (m.includes("demo_purge_deadline_passed")) {
    return { status: 403, code: "demo_purge_deadline_passed" };
  }
  if (m.includes("quote_not_found")) return { status: 400, code: "quote_not_found" };
  if (m.includes("quote_expired")) return { status: 400, code: "quote_expired" };
  if (m.includes("quote_already_consumed")) return { status: 400, code: "quote_already_consumed" };
  if (m.includes("payment_comment_required") || m.includes("payment_comment_too_short")) {
    return { status: 400, code: "payment_comment_too_short" };
  }
  if (m.includes("invalid_submit_payload")) return { status: 400, code: "quote_required" };
  return { status: 500, code: "request_save_failed" };
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
  const quoteId = trimText(body.quote_id, 80);
  const clientRequestId = trimText(body.client_request_id, 80);

  if (trimText(body.request_kind, 40) === "renter_miniapp_addon") {
    return jsonResponse({ error: "addon_purchase_disabled" }, 403, req);
  }

  if (
    trimText(body.request_kind, 40) ||
    trimText(body.payment_method_code, 120) ||
    trimText(body.amount, 80) ||
    trimText(body.currency, 20)
  ) {
    return jsonResponse({ error: "quote_required" }, 400, req);
  }

  if (!organizationId) {
    return jsonResponse({ error: "organization_required" }, 400, req);
  }
  if (!quoteId || !isUuid(quoteId)) {
    return jsonResponse({ error: "quote_required" }, 400, req);
  }
  if (!clientRequestId || !isUuid(clientRequestId)) {
    return jsonResponse({ error: "client_request_id_required" }, 400, req);
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
  const membership = await loadLicensePurchaseOrg(admin, organizationId, userData.user.id);
  if (!membership.ok) {
    return jsonResponse({ error: membership.code }, membership.httpStatus, req);
  }

  const { data: quoteRow, error: quoteError } = await admin
    .from("platform_purchase_quotes")
    .select(
      "id, organization_id, requester_user_id, sku, method_code, amount, currency, pricing_revision, payment_details_snapshot, expires_at, consumed_at"
    )
    .eq("id", quoteId)
    .maybeSingle();

  if (quoteError || !quoteRow) {
    return jsonResponse({ error: "quote_not_found" }, 400, req);
  }

  const requesterEmail = userData.user.email ?? (contactEmail || null);

  const { data: rpcResult, error: rpcError } = await admin.rpc("submit_platform_purchase_request", {
    p_quote_id: quoteId,
    p_client_request_id: clientRequestId,
    p_organization_id: organizationId,
    p_requester_user_id: userData.user.id,
    p_requester_email: requesterEmail,
    p_organization_name: membership.org.name,
    p_contact_email: contactEmail || requesterEmail,
    p_contact_telegram: contactTelegram || null,
    p_payment_comment: paymentComment,
  });

  if (rpcError) {
    const mapped = mapSubmitRpcError(rpcError.message ?? "");
    logEvent("purchase_request_rpc_failed", { code: mapped.code });
    return jsonResponse({ error: mapped.code }, mapped.status, req);
  }

  const payload = rpcResult as {
    ok?: boolean;
    idempotent?: boolean;
    request_id?: string;
    request_kind?: string;
  };

  if (!payload?.ok || !payload.request_id) {
    return jsonResponse({ error: "request_save_failed" }, 500, req);
  }

  const requestId = payload.request_id;
  const requestKind = payload.request_kind ?? quoteRow.sku ?? "crm_license";
  const idempotent = payload.idempotent === true;

  if (!idempotent) {
    await admin.from("platform_audit_log").insert({
      actor_user_id: userData.user.id,
      action: "purchase_request.submit",
      target_type: "platform_purchase_request",
      target_id: requestId,
      metadata: {
        organization_id: organizationId,
        request_kind: requestKind,
        quote_id: quoteId,
        notify: "outbox",
        requester_domain: requesterEmail?.split("@")[1] ?? null,
      },
    });
  }

  const { data: requestRow } = await admin
    .from("platform_purchase_requests")
    .select("email_sent")
    .eq("id", requestId)
    .maybeSingle();

  return jsonResponse(
    {
      ok: true,
      id: requestId,
      email_sent: requestRow?.email_sent === true,
      idempotent,
    },
    200,
    req
  );
});
