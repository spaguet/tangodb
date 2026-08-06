import { handleOptions, jsonResponse, verifyCronSecret } from "../_shared/http.ts";
import {
  LEASE_SECONDS,
  processCalendarSyncJob,
  type OutboxJob,
} from "../_shared/calendarSyncPersonalLesson.ts";
import {
  GoogleCalendarApiError,
  loadGoogleOAuthConfigOrThrow,
} from "../_shared/googleCalendarClient.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";

const DEFAULT_BATCH_SIZE = 20;

function workerId(): string {
  return `calendar-sync-worker-${crypto.randomUUID()}`;
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
    const body = await req.json().catch(() => ({})) as { batch_size?: number };
    if (typeof body.batch_size === "number" && body.batch_size >= 1 && body.batch_size <= 100) {
      batchSize = Math.floor(body.batch_size);
    }
  } catch {
    // use default batch size
  }

  const admin = createServiceClient();
  let oauthConfig;
  try {
    oauthConfig = await loadGoogleOAuthConfigOrThrow();
  } catch (err) {
    const message = err instanceof GoogleCalendarApiError ? err.message : "oauth_not_configured";
    logEvent("gcal_worker_config_error", { message });
    return jsonResponse({ error: "Service unavailable" }, 503, req);
  }

  const runId = workerId();
  const { data: jobs, error: claimError } = await admin.rpc("claim_calendar_sync_jobs", {
    p_batch_size: batchSize,
    p_worker_id: runId,
    p_lease_seconds: LEASE_SECONDS,
  });

  if (claimError) {
    logEvent("gcal_worker_claim_error", { message: claimError.message });
    return jsonResponse({ error: "Claim failed" }, 500, req);
  }

  const claimed = (jobs ?? []) as OutboxJob[];
  let processed = 0;
  let failed = 0;

  for (const job of claimed) {
    try {
      await processCalendarSyncJob(admin, oauthConfig, job);
      processed += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : "unknown";
      logEvent("gcal_worker_job_unhandled", {
        job_id: job.id,
        organization_id: job.organization_id,
        source_type: job.source_type,
        source_id: job.source_id,
        message,
      });

      const availableAt = new Date(Date.now() + 60_000).toISOString();
      await admin
        .from("calendar_sync_outbox")
        .update({
          status: "retry",
          attempt_count: job.attempt_count + 1,
          available_at: availableAt,
          locked_at: null,
          locked_by: null,
          last_error_code: "worker_unhandled",
          last_error_message: message.slice(0, 500),
        })
        .eq("id", job.id);
    }
  }

  logEvent("gcal_worker_batch_complete", {
    worker_id: runId,
    claimed: claimed.length,
    processed,
    failed,
  });

  return jsonResponse(
    {
      ok: true,
      worker_id: runId,
      claimed: claimed.length,
      processed,
      failed,
    },
    200,
    req
  );
});
