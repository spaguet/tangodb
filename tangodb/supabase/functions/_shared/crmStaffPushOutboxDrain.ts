/**
 * A5: drain crm_staff_push_outbox → FCM (server secret only).
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { fcmPushTitle, sendFcmToToken } from "./crmStaffFcm.ts";
import { logEvent } from "./supabase.ts";

const DEFAULT_BATCH_SIZE = 10;
const MAX_DRAIN_BATCHES = 4;
const LEASE_SECONDS = 120;

export type StaffPushOutboxRow = {
  id: string;
  organization_id: string;
  target_member_id: string;
  event_kind: string;
  payload: Record<string, unknown> | null;
  attempts: number;
  max_attempts: number;
  claim_token: string | null;
};

export type StaffPushDrainResult = {
  claimed: number;
  sent: number;
  dead: number;
  retried: number;
  batches: number;
};

function payloadObject(row: StaffPushOutboxRow): Record<string, unknown> {
  return row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload
    : {};
}

function payloadString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === "string" ? value : "";
}

async function completeOutbox(
  admin: SupabaseClient,
  id: string,
  outcome: string,
  claimToken: string | null,
  error?: string | null,
  retrySeconds?: number | null
): Promise<void> {
  const { error: rpcError } = await admin.rpc("complete_crm_staff_push_outbox", {
    p_id: id,
    p_outcome: outcome,
    p_claim_token: claimToken,
    p_error: error ?? null,
    p_retry_seconds: retrySeconds ?? null,
  });
  if (rpcError) {
    logEvent("crm_staff_push_complete_error", { id, message: rpcError.message });
  }
}

export async function drainCrmStaffPushOutbox(
  admin: SupabaseClient,
  opts: { workerId: string; batchSize?: number; timeBudgetMs?: number }
): Promise<StaffPushDrainResult> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const budgetMs = opts.timeBudgetMs ?? 30_000;
  const started = Date.now();
  const result: StaffPushDrainResult = {
    claimed: 0,
    sent: 0,
    dead: 0,
    retried: 0,
    batches: 0,
  };

  for (let batch = 0; batch < MAX_DRAIN_BATCHES; batch++) {
    if (Date.now() - started > budgetMs) break;

    const { data: rows, error: claimError } = await admin.rpc("claim_crm_staff_push_outbox", {
      p_batch_size: batchSize,
      p_worker_id: opts.workerId,
      p_lease_seconds: LEASE_SECONDS,
    });

    if (claimError) {
      logEvent("crm_staff_push_claim_error", { message: claimError.message });
      break;
    }

    const claimed = (rows ?? []) as StaffPushOutboxRow[];
    if (claimed.length === 0) break;

    result.batches += 1;
    result.claimed += claimed.length;

    for (const row of claimed) {
      const payload = payloadObject(row);
      const body = payloadString(payload, "body") || payloadString(payload, "label") || row.event_kind;
      const title = fcmPushTitle(row.event_kind);

      const { data: devices, error: devicesError } = await admin
        .from("crm_staff_push_devices")
        .select("id, fcm_token")
        .eq("organization_id", row.organization_id)
        .eq("member_id", row.target_member_id)
        .is("revoked_at", null);

      if (devicesError) {
        await completeOutbox(admin, row.id, "retry", row.claim_token, devicesError.message, 120);
        result.retried += 1;
        continue;
      }

      const tokens = (devices ?? []) as { id: string; fcm_token: string }[];
      if (tokens.length === 0) {
        await completeOutbox(admin, row.id, "sent", row.claim_token);
        result.sent += 1;
        continue;
      }

      let anySent = false;
      let allInvalid = true;

      for (const device of tokens) {
        const outcome = await sendFcmToToken(device.fcm_token, title, body, {
          kind: row.event_kind,
          organization_id: row.organization_id,
        });

        if (outcome === "sent") {
          anySent = true;
          allInvalid = false;
        } else if (outcome === "invalid_token") {
          await admin
            .from("crm_staff_push_devices")
            .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", device.id);
        } else {
          allInvalid = false;
        }
      }

      if (anySent || tokens.length === 0) {
        await completeOutbox(admin, row.id, "sent", row.claim_token);
        result.sent += 1;
      } else if (row.attempts >= row.max_attempts) {
        await completeOutbox(admin, row.id, "dead", row.claim_token, "max_attempts");
        result.dead += 1;
      } else if (allInvalid) {
        await completeOutbox(admin, row.id, "sent", row.claim_token);
        result.sent += 1;
      } else {
        await completeOutbox(admin, row.id, "retry", row.claim_token, "fcm_failed", 180);
        result.retried += 1;
      }
    }
  }

  return result;
}
