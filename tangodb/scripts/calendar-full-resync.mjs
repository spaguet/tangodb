/**
 * Full Google Calendar resync for a teacher: purge managed events + rewrite from CRM.
 * Enqueues refresh_member; production worker cron (~every 2 min) processes the outbox.
 *
 * Optional: set CRON_SECRET in .env.local to invoke worker immediately in a tight loop.
 *
 * Usage: node scripts/calendar-full-resync.mjs [--org-id=UUID] [--member-id=UUID] [--wait]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.local", ".env.migrate", ".env"]) {
  const path = resolve(root, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const orgId =
  process.argv.find((a) => a.startsWith("--org-id="))?.slice(9) ??
  "8da4b806-f9c8-49eb-8431-ec7e0a5390a1";
const memberId =
  process.argv.find((a) => a.startsWith("--member-id="))?.slice(12) ??
  "19ad057b-74c9-4fc2-bfc8-a1a9b72f6b47";
const shouldWait = process.argv.includes("--wait");

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_CRON_SECRET;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const sb = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function pendingCount() {
  const { count, error } = await sb
    .from("calendar_sync_outbox")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .in("status", ["pending", "retry"]);
  if (error) throw error;
  return count ?? 0;
}

async function runWorker(batchSize = 50) {
  if (!cronSecret) return null;
  const res = await fetch(`${supabaseUrl}/functions/v1/calendar-sync-worker`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      "x-cron-secret": cronSecret,
    },
    body: JSON.stringify({ batch_size: batchSize }),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Worker HTTP ${res.status}: ${body}`);
  }
  return JSON.parse(body);
}

async function linkCounts() {
  const [{ count: groupLinks }, { count: personalLinks }] = await Promise.all([
    sb
      .from("google_calendar_event_links")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("source_type", "group_occurrence"),
    sb
      .from("google_calendar_event_links")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("source_type", "personal_lesson"),
  ]);
  return { groupLinks: groupLinks ?? 0, personalLinks: personalLinks ?? 0 };
}

console.log(JSON.stringify({ orgId, memberId, action: "enqueue_refresh_member" }));

const { error: enqueueError } = await sb.rpc("enqueue_calendar_sync", {
  p_organization_id: orgId,
  p_source_type: "personal_lesson",
  p_source_id: memberId,
  p_occurrence_date: null,
  p_operation: "refresh_member",
});
if (enqueueError) throw enqueueError;

if (!shouldWait && !cronSecret) {
  console.log(
    JSON.stringify({
      ok: true,
      message:
        "refresh_member enqueued; worker cron will process within ~2 minutes. Re-run with --wait to poll.",
    })
  );
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let iterations = 0;

while (iterations < 120) {
  if (cronSecret) {
    const result = await runWorker(50);
    if (result) {
      console.log(JSON.stringify({ worker: result }));
    }
  }

  const pending = await pendingCount();
  const links = await linkCounts();
  iterations += 1;
  console.log(JSON.stringify({ poll: iterations, pending, ...links }));

  if (pending === 0 && links.groupLinks > 10) break;
  await sleep(cronSecret ? 5000 : 15000);
}

console.log(JSON.stringify({ done: true, remaining_pending: await pendingCount(), ...(await linkCounts()) }));
