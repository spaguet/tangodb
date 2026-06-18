const STRIPE_API = "https://api.stripe.com/v1";

function stripeAuthHeader(): string {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  return `Bearer ${key}`;
}

function encodeForm(data: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== null) params.append(k, String(v));
  }
  return params.toString();
}

export async function createCheckoutSession(opts: {
  customerEmail: string;
  priceId: string;
  organizationId: string;
  userId: string;
  billingPeriod: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<{ url: string; session_id: string }> {
  const body = encodeForm({
    mode: "subscription",
    "customer_email": opts.customerEmail,
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": 1,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    "metadata[organization_id]": opts.organizationId,
    "metadata[user_id]": opts.userId,
    "metadata[billing_period]": opts.billingPeriod,
    "subscription_data[metadata][organization_id]": opts.organizationId,
  });

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: stripeAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error?.message ?? "Stripe checkout failed");
  }

  return { url: json.url as string, session_id: json.id as string };
}

export async function retrieveSubscription(subscriptionId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API}/subscriptions/${subscriptionId}`, {
    headers: { Authorization: stripeAuthHeader() },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? "Stripe subscription fetch failed");
  return json as Record<string, unknown>;
}

export function mapStripeSubscriptionStatus(stripeStatus: string): "active" | "past_due" | "canceled" {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    default:
      return "canceled";
  }
}

export async function verifyStripeWebhook(
  payload: string,
  signatureHeader: string,
  secret: string
): Promise<boolean> {
  const parts = signatureHeader.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false;

  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export function stripePeriodEnd(sub: Record<string, unknown>): string | null {
  const end = sub.current_period_end;
  if (typeof end === "number") return new Date(end * 1000).toISOString();
  return null;
}

export function stripePeriodStart(sub: Record<string, unknown>): string | null {
  const start = sub.current_period_start;
  if (typeof start === "number") return new Date(start * 1000).toISOString();
  return null;
}
