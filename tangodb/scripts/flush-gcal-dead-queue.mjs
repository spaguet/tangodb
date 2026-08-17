/**
 * Requeue dead calendar sync jobs after token recovery (service role).
 * Usage: node scripts/flush-gcal-dead-queue.mjs [--org-id=UUID]
 */
import { createSupabaseClient, loadEnv } from "./lib/import-common.mjs";

loadEnv();
const sb = createSupabaseClient();
const orgFilter = process.argv.find((a) => a.startsWith("--org-id="))?.slice(9) ?? null;

async function countByStatus() {
  const statuses = ["pending", "retry", "processing", "dead", "done"];
  const out = {};
  for (const s of statuses) {
    let q = sb.from("calendar_sync_outbox").select("*", { count: "exact", head: true }).eq("status", s);
    if (orgFilter) q = q.eq("organization_id", orgFilter);
    const { count } = await q;
    out[s] = count ?? 0;
  }
  return out;
}

let orgIds = [];
if (orgFilter) {
  orgIds = [orgFilter];
} else {
  const { data } = await sb
    .from("calendar_sync_outbox")
    .select("organization_id")
    .eq("status", "dead")
    .eq("last_error_code", "token_revoked");
  orgIds = [...new Set((data ?? []).map((r) => r.organization_id))];
}

console.log("before", await countByStatus());

if (!orgIds.length) {
  console.log("No orgs with token_revoked dead jobs.");
  process.exit(0);
}

const { data, error } = await sb.rpc("service_retry_calendar_sync_dead_jobs_for_orgs", {
  p_organization_ids: orgIds,
});
if (error) throw error;

console.log("retry result", data);
console.log("after", await countByStatus());
