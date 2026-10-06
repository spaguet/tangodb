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
import { shouldPauseGoogleCalendarForOrg } from "./editionLifecycle.ts";
import { markJobDone, markJobRetry } from "./calendarSyncCommon.ts";
import { logEvent } from "./supabase.ts";
import {
  MAX_CALENDAR_SYNC_BATCHES,
  nextCalendarSyncChainDepth,
  shouldChainCalendarSync,
} from "./workerLoopPolicy.ts";

export const DEFAULT_WORKER_BATCH_SIZE = 40;
/** Short on purpose: cron is every 2 minutes, and this tick must not occupy the whole gap. */
export const WORKER_TIME_BUDGET_MS = 30_000;
export const KICK_TIME_BUDGET_MS = 20_000;
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

export async function calendarSyncLeaseHeld(admin: SupabaseClient): Promise<boolean> {
  const cutoff = new Date(Date.now() - LEASE_SECONDS * 1000).toISOString();
  const { count, error } = await admin
    .from("calendar_sync_outbox")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .gt("locked_at", cutoff);

  if (error) {
    logEvent("gcal_worker_lease_check_error", { message: error.message.slice(0, 200) });
    return true;
  }
  return (count ?? 0) > 0;
}

export function chainCalendarSyncWorker(reason: string, chainDepth: number): void {
  const nextDepth = nextCalendarSyncChainDepth(chainDepth);
  if (nextDepth == null) {
    logEvent("gcal_worker_chain_skipped", { reason, chain_depth: chainDepth });
    return;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/$/, "");
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (!supabaseUrl || !cronSecret) {
    logEvent("gcal_worker_chain_skipped", { reason, missing: "env", chain_depth: chainDepth });
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
      body: JSON.stringify({ chain_depth: nextDepth }),
    })
      .then(async (res) => {
        logEvent("gcal_worker_chain_started", {
          reason,
          status: res.status,
          chain_depth: nextDepth,
        });
      })
      .catch((err) => {
        logEvent("gcal_worker_chain_error", {
          reason,
          message: err instanceof Error ? err.message.slice(0, 200) : "unknown",
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
    chainDepth?: number;
  }
): Promise<CalendarSyncRunResult> {
  const startedAt = Date.now();
  let processed = 0;
  let failed = 0;
  let claimed = 0;
  let batches = 0;
  let shouldContinue = false;

  while (
    Date.now() - startedAt < options.timeBudgetMs &&
    batches < MAX_CALENDAR_SYNC_BATCHES
  ) {
    const { data: jobs, error: claimError } = await admin.rpc("claim_calendar_sync_jobs", {
      p_batch_size: options.batchSize,
      p_worker_id: `${options.workerId}-b${batches + 1}`,
      p_lease_seconds: LEASE_SECONDS,
      p_organization_id: options.organizationId ?? null,
    });

    if (claimError) {
      logEvent("gcal_worker_claim_error", { message: claimError.message.slice(0, 200) });
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
        const availableAt = new Date(Date.now() + 60_000).toISOString();
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

      if (await shouldPauseGoogleCalendarForOrg(admin, job.organization_id)) {
        logEvent("gcal_worker_job_edition_skip", {
          job_id: job.id,
          organization_id: job.organization_id,
          operation: job.operation,
          source_type: job.source_type,
        });
        await markJobDone(admin, job.id);
        processed += 1;
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
          message: message.slice(0, 200),
        });

        await markJobRetry(admin, job, "worker_unhandled", message);
      }
    }

    if (!shouldContinue) break;
  }

  const chainDepth = options.chainDepth ?? 0;
  if (
    options.chainIfNeeded &&
    shouldChainCalendarSync({
      chainDepth,
      shouldContinue,
      processed,
    })
  ) {
    chainCalendarSyncWorker("time_budget_or_full_batch", chainDepth);
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
