// R1d/R4: Mini App booking worker (cron every 2 min, like GCAL-3).
// verify_jwt=false; callers send x-cron-secret. Maintenance in SQL; Telegram drain in Edge.

import { handleOptions, jsonResponse, verifyCronSecret } from "../_shared/http.ts";
import { drainRenterTelegramOutbox } from "../_shared/renterTelegramOutboxDrain.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";
import {
  MAINTENANCE_TIME_BUDGET_MS,
  shouldContinueMaintenance,
} from "../_shared/workerLoopPolicy.ts";

/** Telegram drain uses whatever remains after maintenance. Kept under the 2-minute cron gap. */
export const WORKER_TIME_BUDGET_MS = 45_000;
const DEFAULT_BATCH_SIZE = 20;
const OUTBOX_BATCH_SIZE = 10;

type MaintenanceFailure = { error?: string; sqlstate?: string };

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
    if (typeof body.batch_size === "number" && body.batch_size >= 1 && body.batch_size <= DEFAULT_BATCH_SIZE) {
      batchSize = Math.floor(body.batch_size);
    }
  } catch {
    // default batch
  }

  const admin = createServiceClient();
  const started = Date.now();
  let processed = 0;
  let batches = 0;

  while (Date.now() - started < MAINTENANCE_TIME_BUDGET_MS) {
    const { data, error } = await admin.rpc("run_renter_booking_maintenance", {
      p_batch_size: batchSize,
    });

    if (error) {
      logEvent("renter_booking_worker_error", {
        message: error.message.slice(0, 200),
        batches,
      });
      return jsonResponse({ error: "Maintenance job failed" }, 500, req);
    }

    const row = data as {
      ok?: boolean;
      processed?: number;
      failed?: number;
      failures?: MaintenanceFailure[];
      progressed?: boolean;
    } | null;
    const n = Number(row?.processed ?? 0);
    const failed = Number(row?.failed ?? 0);
    const progressed = row?.progressed === true;
    batches += 1;
    processed += n;
    if (failed > 0) {
      const first = row?.failures?.[0];
      logEvent("renter_booking_worker_partial_failure", {
        failed,
        batches,
        sqlstate: typeof first?.sqlstate === "string" ? first.sqlstate.slice(0, 10) : null,
        error: typeof first?.error === "string" ? first.error.slice(0, 200) : null,
      });
    }
    const elapsedMs = Date.now() - started;
    if (
      !shouldContinueMaintenance({
        batches,
        processed: n,
        failed,
        progressed,
        elapsedMs,
      })
    ) {
      if (elapsedMs >= MAINTENANCE_TIME_BUDGET_MS) {
        logEvent("renter_booking_worker_slow", { batches, processed, elapsed_ms: elapsedMs });
      }
      break;
    }
  }

  const drainStarted = Date.now();
  const drain = await drainRenterTelegramOutbox(admin, {
    workerId: `renter-booking-worker-${crypto.randomUUID()}`,
    batchSize: OUTBOX_BATCH_SIZE,
    timeBudgetMs: Math.max(0, WORKER_TIME_BUDGET_MS - (drainStarted - started)),
    startedAt: drainStarted,
  });

  logEvent("renter_booking_worker_complete", {
    processed,
    batches,
    drain_claimed: drain.claimed,
    drain_sent: drain.sent,
    drain_dead: drain.dead,
    drain_waiting: drain.waiting,
    drain_batches: drain.batches,
  });
  return jsonResponse(
    {
      ok: true,
      processed,
      batches,
      drain_claimed: drain.claimed,
      drain_sent: drain.sent,
    },
    200,
    req
  );
});
