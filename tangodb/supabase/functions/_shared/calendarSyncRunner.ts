/**
 * Drain loop for calendar-sync-worker and user-triggered calendar-sync-kick.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  LEASE_SECONDS,
  processCalendarSyncJob,
  type OutboxJob,
} from "./calendarSyncPersonalLesson.ts";
import type { GoogleOAuthConfig } from "./googleOAuth.ts";
import { logEvent } from "./supabase.ts";

export const DEFAULT_WORKER_BATCH_SIZE = 40;
export const WORKER_TIME_BUDGET_MS = 110_000;
export const KICK_TIME_BUDGET_MS = 45_000;
export const KICK_BATCH_SIZE = 40;

export type CalendarSyncRunResult = {
  processed: number;
  failed: number;
  claimed: number;
  batches: number;
  shouldContinue: boolean;
};

function waitUntil(promise: Promise<unknown>): void {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(promise);
    return;
  }
  void promise;
}

export function chainCalendarSyncWorker(reason: string): void {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!supabaseUrl || !cronSecret) {
    logEvent("gcal_worker_chain_skipped", { reason, missing: "env" });
    return;
  }

  const url = `${supabaseUrl}/functions/v1/calendar-sync-worker`;
  waitUntil(
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-cron-secret": cronSecret,
      },
      body: "{}",
    })
      .then(async (res) => {
        logEvent("gcal_worker_chain_started", {
          reason,
          status: res.status,
        });
      })
      .catch((err) => {
        logEvent("gcal_worker_chain_error", {
          reason,
          message: err instanceof Error ? err.message : "unknown",
        });
      })
  );
}

export async function runCalendarSyncBatches(
  admin: SupabaseClient,
  oauthConfig: GoogleOAuthConfig,
  options: {
    batchSize: number;
    timeBudgetMs: number;
    workerId: string;
    organizationId?: string | null;
    chainIfNeeded?: boolean;
  }
): Promise<CalendarSyncRunResult> {
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;
  let claimed = 0;
  let batches = 0;
  let shouldContinue = false;

  while (Date.now() - startedAt < options.timeBudgetMs) {
    const { data: jobs, error: claimError } = await admin.rpc("claim_calendar_sync_jobs", {
      p_batch_size: options.batchSize,
      p_worker_id: `${options.workerId}-b${batches + 1}`,
      p_lease_seconds: LEASE_SECONDS,
      p_organization_id: options.organizationId ?? null,
    });

    if (claimError) {
      logEvent("gcal_worker_claim_error", { message: claimError.message });
      throw new Error("Claim failed");
    }

    const claimedBatch = (jobs ?? []) as OutboxJob[];
    batches += 1;
    claimed += claimedBatch.length;
    shouldContinue = claimedBatch.length >= options.batchSize;

    if (claimedBatch.length === 0) {
      shouldContinue = false;
      break;
    }

    for (const job of claimedBatch) {
      if (Date.now() - startedAt >= options.timeBudgetMs) {
        shouldContinue = true;
        const availableAt = new Date().toISOString();
        await admin
          .from("calendar_sync_outbox")
          .update({
            status: "retry",
            available_at: availableAt,
            locked_at: null,
            locked_by: null,
          })
          .eq("id", job.id)
          .eq("status", "processing");
        continue;
      }

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

    if (!shouldContinue) break;
  }

  if (options.chainIfNeeded && shouldContinue) {
    chainCalendarSyncWorker("time_budget_or_full_batch");
  }

  logEvent("gcal_worker_batch_complete", {
    worker_id: options.workerId,
    claimed,
    processed,
    failed,
    batches,
    should_continue: shouldContinue,
    elapsed_ms: Date.now() - startedAt,
  });

  return { processed, failed, claimed, batches, shouldContinue };
}
