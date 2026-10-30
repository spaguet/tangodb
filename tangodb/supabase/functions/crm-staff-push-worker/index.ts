// A5: CRM staff FCM outbox drain. Cron: CRON_SECRET. FCM secret: FCM_SERVICE_ACCOUNT_JSON (server only).

import { handleOptions, jsonResponse, verifyCronSecret } from "../_shared/http.ts";
import { drainCrmStaffPushOutbox } from "../_shared/crmStaffPushOutboxDrain.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

export const WORKER_TIME_BUDGET_MS = 30_000;
const DEFAULT_BATCH_SIZE = 10;

function workerId(): string {
  return `crm-staff-push-worker-${crypto.randomUUID()}`;
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
    if (typeof body.batch_size === "number" && body.batch_size >= 1 && body.batch_size <= DEFAULT_BATCH_SIZE) {
      batchSize = Math.floor(body.batch_size);
    }
  } catch {
    // default batch
  }

  const admin = createServiceClient();
  const runId = workerId();
  const drain = await drainCrmStaffPushOutbox(admin, {
    workerId: runId,
    batchSize,
    timeBudgetMs: WORKER_TIME_BUDGET_MS,
  });

  logEvent("crm_staff_push_worker_complete", {
    worker_id: runId,
    claimed: drain.claimed,
    sent: drain.sent,
    dead: drain.dead,
    batches: drain.batches,
  });
  return jsonResponse({ ok: true, worker_id: runId, ...drain }, 200, req);
});
