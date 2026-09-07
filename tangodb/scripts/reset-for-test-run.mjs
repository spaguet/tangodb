/**
 * Reset a *local* database for a fresh test run.
 * Keeps platform developer admin (email + auth profile); removes tenants, keys, registrations.
 *
 * Env (.env.local): DATABASE_URL pointing at local `supabase start`.
 * Optional: ADMIN_KEEP_EMAIL (default albertkoall@gmail.com)
 *
 * Production / linked hosted wipe is forbidden unless ALLOW_PROD_DB_RESET=1.
 *
 * Usage: node scripts/reset-for-test-run.mjs [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { assertNotHostedSupabase, isHostedSupabaseUrl, loadDbTestEnv } from "./load-db-test-env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

loadDbTestEnv({ refuseHosted: false });

const allowProdReset = process.env.ALLOW_PROD_DB_RESET === "1";
if (!allowProdReset) {
  assertNotHostedSupabase();
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const keepEmail = (process.env.ADMIN_KEEP_EMAIL || "albertkoall@gmail.com").toLowerCase();

async function clearStorageExports() {
  if (!supabaseUrl || !serviceKey) return;
  if (!allowProdReset && isHostedSupabaseUrl(supabaseUrl)) {
    console.warn(
      "skipping storage/exports wipe: hosted SUPABASE_URL (set ALLOW_PROD_DB_RESET=1 to wipe production storage)",
    );
    return;
  }
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
  const dbUrl = process.env.DATABASE_URL;

  if (dryRun) {
    console.log("[dry-run] would run SQL reset via psql DATABASE_URL");
    console.log(`  admin keep email: ${keepEmail}`);
    return;
  }

  if (!dbUrl) {
    console.error(
      "DATABASE_URL is not set. Point it at local `supabase start` (postgresql://postgres:postgres@127.0.0.1:54322/postgres).",
    );
    process.exit(1);
  }

  const result = spawnSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", sqlPath], {
    encoding: "utf8",
    cwd: root,
    shell: false,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error(`psql reset exited with code ${result.status}`);
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
