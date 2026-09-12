// S5a: platform notification outbox drain (email + Telegram).
// Cron: CRON_SECRET. Outbound only — never getUpdates / setWebhook.

import { handleOptions, jsonResponse, verifyCronSecret } from "../_shared/http.ts";
import { drainPlatformNotificationOutbox } from "../_shared/platformNotificationOutboxDrain.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

export const WORKER_TIME_BUDGET_MS = 110_000;
const DEFAULT_BATCH_SIZE = 10;

function workerId(): string {
  return `platform-notification-worker-${crypto.randomUUID()}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  if (!verifyCronSecret(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let batchSize = DEFAULT_BATCH_SIZE;
  try {
    const body = (await req.json().catch(() => ({}))) as { batch_size?: number };
    if (typeof body.batch_size === "number" && body.batch_size >= 1 && body.batch_size <= 50) {
      batchSize = Math.floor(body.batch_size);
    }
  } catch {
    // default batch
  }

  const admin = createServiceClient();
  const runId = workerId();
  const drain = await drainPlatformNotificationOutbox(admin, {
    workerId: runId,
    batchSize,
    timeBudgetMs: WORKER_TIME_BUDGET_MS,
  });

  logEvent("platform_notification_worker_complete", { worker_id: runId, drain });
  return jsonResponse({ ok: true, worker_id: runId, ...drain }, 200, req);
});
