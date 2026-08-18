/**
 * Reset Supabase data for a fresh test run.
 * Keeps platform developer admin (email + auth profile); removes tenants, keys, registrations.
 *
 * Env (.env.local): SUPABASE_ACCESS_TOKEN, SUPABASE_SERVICE_KEY, VITE_SUPABASE_URL
 * Optional: ADMIN_KEEP_EMAIL (default albertkoall@gmail.com)
 *
 * Usage: node scripts/reset-for-test-run.mjs [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const keepEmail = (process.env.ADMIN_KEEP_EMAIL || "albertkoall@gmail.com").toLowerCase();

async function clearStorageExports() {
  if (!supabaseUrl || !serviceKey) return;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: top, error } = await admin.storage.from("exports").list("", { limit: 1000 });
  if (error) {
    console.warn(`storage/exports: ${error.message}`);
    return;
  }
  const paths = (top ?? []).filter((item) => item.name).map((item) => item.name);
  if (!paths.length) return;
  if (dryRun) {
    console.log(`[dry-run] would remove ${paths.length} objects from storage/exports`);
    return;
  }
  const { error: rmError } = await admin.storage.from("exports").remove(paths);
  if (rmError) console.warn(`storage/exports remove: ${rmError.message}`);
  else console.log(`cleared storage/exports (${paths.length} objects)`);
}

function runSqlReset() {
  const sqlPath = resolve(root, "supabase/scripts/reset_for_test_run.sql");
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

  if (dryRun) {
    console.log("[dry-run] would run SQL reset via supabase db query --linked");
    console.log(`  admin keep email: ${keepEmail}`);
    return;
  }

  if (!accessToken) {
    console.error("Missing SUPABASE_ACCESS_TOKEN in .env.local (for supabase db query --linked)");
    process.exit(1);
  }

  const result = spawnSync("npx supabase db query --linked -f \"" + sqlPath.replace(/\\/g, "/") + "\"", {
    encoding: "utf8",
    cwd: root,
    shell: true,
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken },
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`supabase db query exited with code ${result.status}`);
  }
}

async function main() {
  console.log(dryRun ? "DRY RUN — no changes" : "Resetting database for test run…");
  console.log(`Keeping admin: ${keepEmail}`);

  runSqlReset();
  console.log("\nClearing storage exports bucket…");
  await clearStorageExports();

  console.log("\nDone.");
  console.log("Next: sign out in browser (or clear site data), then register / login fresh.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
