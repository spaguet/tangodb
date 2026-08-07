/**
 * One-off diagnostics for Google Calendar sync (outbox, bindings, links).
 * Usage: node scripts/_check-gcal-sync.mjs
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const base = `${env.SUPABASE_URL}/rest/v1`;
const key = env.SUPABASE_SERVICE_KEY;
if (!base || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local");
  process.exit(1);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
};

async function countByStatus(table, status) {
  const res = await fetch(`${base}/${table}?select=id&status=eq.${status}`, {
    method: "HEAD",
    headers: { ...headers, Prefer: "count=exact" },
  });
  const range = res.headers.get("content-range") ?? "*/0";
  return Number(range.split("/").pop() || 0);
}

async function fetchJson(path) {
  const res = await fetch(`${base}/${path}`, { headers });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("=== Google Calendar sync diagnostics ===\n");
  console.log(`Project: ${env.SUPABASE_URL}\n`);

  console.log("--- calendar_sync_outbox ---");
  for (const st of ["pending", "retry", "processing", "done", "dead"]) {
    const n = await countByStatus("calendar_sync_outbox", st);
    console.log(`  ${st}: ${n}`);
  }

  const recent = await fetchJson(
    "calendar_sync_outbox?select=id,source_type,status,created_at,processed_at,last_error_code,attempt_count&order=created_at.desc&limit=8"
  );
  console.log("\n  recent jobs:");
  for (const row of recent) {
    console.log(
      `  - ${row.source_type} ${row.status} created=${row.created_at} processed=${row.processed_at ?? "—"} err=${row.last_error_code ?? "—"} attempts=${row.attempt_count}`
    );
  }

  console.log("\n--- member_google_calendar_bindings (enabled) ---");
  const bindings = await fetchJson(
    "member_google_calendar_bindings?select=id,enabled,sync_personal,sync_group,last_success_at,last_error_code,last_error_at,calendar_name&enabled=eq.true"
  );
  if (!bindings.length) console.log("  (none)");
  for (const b of bindings) {
    console.log(
      `  - ${b.calendar_name}: last_success=${b.last_success_at ?? "—"} last_error=${b.last_error_code ?? "—"}`
    );
  }

  console.log("\n--- google_calendar_event_links ---");
  const linkCount = await fetch(`${base}/google_calendar_event_links?select=id`, {
    method: "HEAD",
    headers: { ...headers, Prefer: "count=exact" },
  }).then((r) => Number((r.headers.get("content-range") ?? "*/0").split("/").pop() || 0));
  console.log(`  total: ${linkCount}`);
  const links = await fetchJson(
    "google_calendar_event_links?select=source_type,sync_status,last_synced_at,last_error,updated_at&order=updated_at.desc&limit=8"
  );
  for (const l of links) {
    console.log(
      `  - ${l.source_type} ${l.sync_status} synced=${l.last_synced_at ?? "—"} err=${l.last_error ?? "—"}`
    );
  }

  console.log("\n--- user_google_accounts ---");
  const accounts = await fetchJson(
    "user_google_accounts?select=google_email,status,updated_at&order=updated_at.desc&limit=5"
  );
  for (const a of accounts) {
    console.log(`  - ${a.google_email} (${a.status}) updated=${a.updated_at}`);
  }

  console.log("\n--- summary ---");
  const pending = await countByStatus("calendar_sync_outbox", "pending");
  const retry = await countByStatus("calendar_sync_outbox", "retry");
  const dead = await countByStatus("calendar_sync_outbox", "dead");
  const done = await countByStatus("calendar_sync_outbox", "done");
  if (pending + retry > 0 && linkCount === 0) {
    console.log("  FAIL: jobs still queued, no synced links — worker likely not running or auth failing");
  } else if (linkCount > 0 && pending + retry === 0) {
    console.log("  OK: outbox drained and event links exist");
  } else if (dead > 0) {
    console.log("  WARN: dead-letter jobs present — check last_error_code on outbox rows");
  } else {
    console.log("  PARTIAL: review counts above");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
