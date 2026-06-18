import {
  mapStripeSubscriptionStatus,
  retrieveSubscription,
  stripePeriodEnd,
  stripePeriodStart,
  verifyStripeWebhook,
} from "../_shared/stripe.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

type StripeEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

async function syncFromSubscription(
  admin: ReturnType<typeof createServiceClient>,
  sub: Record<string, unknown>,
  eventId: string,
  eventType: string
): Promise<void> {
  const metadata = (sub.metadata ?? {}) as Record<string, string>;
  const orgId = metadata.organization_id;
  if (!orgId) return;

  const status = mapStripeSubscriptionStatus(String(sub.status ?? "canceled"));
  const items = sub.items as { data?: Array<{ price?: { lookup_key?: string; id?: string } }> } | undefined;
  const priceMeta = items?.data?.[0]?.price;
  const plan = priceMeta?.lookup_key ?? priceMeta?.id ?? "standard";
  const interval = (sub as { plan?: { interval?: string } }).plan?.interval
    ?? (items?.data?.[0] as { plan?: { interval?: string } } | undefined)?.plan?.interval;
  const billingPeriod = interval === "year" ? "yearly" : "monthly";

  const { error } = await admin.rpc("sync_organization_subscription", {
    p_organization_id: orgId,
    p_plan: plan,
    p_billing_period: billingPeriod,
    p_status: status,
    p_provider: "stripe",
    p_provider_customer_id: String(sub.customer ?? ""),
    p_provider_subscription_id: String(sub.id ?? ""),
    p_current_period_start: stripePeriodStart(sub),
    p_current_period_end: stripePeriodEnd(sub),
    p_event_id: eventId,
    p_event_type: eventType,
  });

  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return new Response(JSON.stringify({ error: "Service unavailable" }), { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature" }), { status: 400 });
  }

  const payload = await req.text();
  const valid = await verifyStripeWebhook(payload, signature, webhookSecret);
  if (!valid) {
    return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(payload) as StripeEvent;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400 });
  }

  const admin = createServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const subscriptionId = session.subscription as string | undefined;
        if (subscriptionId) {
          const sub = await retrieveSubscription(subscriptionId);
          await syncFromSubscription(admin, sub, event.id, event.type);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object;
        await syncFromSubscription(admin, sub, event.id, event.type);
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription as string | undefined;
        if (subscriptionId) {
          const sub = await retrieveSubscription(subscriptionId);
          await syncFromSubscription(admin, { ...sub, status: "past_due" }, event.id, event.type);
        }
        break;
      }
      default:
        break;
    }

    logEvent("stripe_webhook_processed", { type: event.type, event_id: event.id });
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logEvent("stripe_webhook_error", {
      type: event.type,
      message: err instanceof Error ? err.message : "unknown",
    });
    return new Response(JSON.stringify({ error: "Webhook processing failed" }), { status: 500 });
  }
});
