import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { isRenterActor, renterActorForbidden } from "../_shared/staffAuth.ts";
import { createCheckoutSession } from "../_shared/stripe.ts";
import { requireSiteUrl } from "../_shared/siteUrl.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 15 * 60_000;

const PRICE_ENV: Record<string, string> = {
  monthly: "STRIPE_PRICE_ID_MONTHLY",
  yearly: "STRIPE_PRICE_ID_YEARLY",
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
  if (!(await checkRateLimit(`checkout:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }
  if (isRenterActor(userData.user)) {
    return renterActorForbidden(req);
  }

  let body: { billing_period?: string; organization_id?: string };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const billingPeriod = (body.billing_period ?? "monthly").trim();
  if (billingPeriod !== "monthly" && billingPeriod !== "yearly") {
    return jsonResponse({ error: "Invalid billing period" }, 400, req);
  }

  const organizationId = body.organization_id?.trim();
  if (!organizationId) {
    return jsonResponse({ error: "organization_id required" }, 400, req);
  }

  const admin = createServiceClient();

  const { data: member } = await admin
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (!member || member.role !== "owner") {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  const { data: lifetimeLicense } = await admin
    .from("organization_licenses")
    .select("license_type")
    .eq("organization_id", organizationId)
    .eq("license_type", "lifetime")
    .maybeSingle();

  if (lifetimeLicense) {
    return jsonResponse({ error: "Organization has lifetime license" }, 400, req);
  }

  const priceEnvKey = PRICE_ENV[billingPeriod];
  const priceId = Deno.env.get(priceEnvKey);
  if (!priceId) {
    return jsonResponse({ error: "Billing not configured" }, 503, req);
  }

  const siteUrl = requireSiteUrl();
  if (!siteUrl) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }
  const email = userData.user.email ?? "";

  try {
    const session = await createCheckoutSession({
      customerEmail: email,
      priceId,
      organizationId,
      userId: userData.user.id,
      billingPeriod,
      successUrl: `${siteUrl}/settings/license?checkout=success`,
      cancelUrl: `${siteUrl}/settings/license?checkout=canceled`,
    });

    logEvent("subscription_checkout_created", {
      organization_id: organizationId,
      billing_period: billingPeriod,
    });

    return jsonResponse({ ok: true, url: session.url, session_id: session.session_id }, 200, req);
  } catch (err) {
    logEvent("subscription_checkout_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return jsonResponse({ error: "Checkout failed" }, 500, req);
  }
});
