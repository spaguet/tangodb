// R1d/R4: Mini App booking worker (cron every 2 min, like GCAL-3).
// verify_jwt=false; callers send x-cron-secret. Maintenance in SQL; Telegram drain in Edge.

import { handleOptions, jsonResponse, verifyCronSecret } from "../_shared/http.ts";
import { drainRenterTelegramOutbox } from "../_shared/renterTelegramOutboxDrain.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

/** Same HTTP time budget as calendar-sync-worker (`WORKER_TIME_BUDGET_MS`). */
export const WORKER_TIME_BUDGET_MS = 110_000;
const DEFAULT_BATCH_SIZE = 20;
const OUTBOX_BATCH_SIZE = 10;

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
    const body = await req.json().catch(() => ({})) as { batch_size?: number };
    if (typeof body.batch_size === "number" && body.batch_size >= 1 && body.batch_size <= 100) {
      batchSize = Math.floor(body.batch_size);
    }
  } catch {
    // default batch
  }

  const admin = createServiceClient();
  const started = Date.now();
  let processed = 0;
  let batches = 0;

  while (Date.now() - started < WORKER_TIME_BUDGET_MS) {
    const { data, error } = await admin.rpc("run_renter_booking_maintenance", {
      p_batch_size: batchSize,
    });

    if (error) {
      logEvent("renter_booking_worker_error", { message: error.message, batches });
      return jsonResponse({ error: "Maintenance job failed" }, 500, req);
    }

    const row = data as {
      ok?: boolean;
      processed?: number;
      failed?: number;
      failures?: unknown[];
    } | null;
    const n = Number(row?.processed ?? 0);
    const failed = Number(row?.failed ?? 0);
    batches += 1;
    processed += n;
    if (failed > 0) {
      logEvent("renter_booking_worker_partial_failure", {
        failed,
        failures: row?.failures,
        batches,
      });
    }
    if (n + failed === 0) break;
  }

  const drainStarted = Date.now();
  const drain = await drainRenterTelegramOutbox(admin, {
    workerId: `renter-booking-worker-${crypto.randomUUID()}`,
    batchSize: OUTBOX_BATCH_SIZE,
    timeBudgetMs: WORKER_TIME_BUDGET_MS - (drainStarted - started),
    startedAt: drainStarted,
  });

  logEvent("renter_booking_worker_complete", { processed, batches, drain });
  return jsonResponse({ ok: true, processed, batches, drain }, 200, req);
});
