/**
 * Upload dist-crm-release/ to updates origin via Wrangler R2 (optional).
 *
 * Env:
 *   UPDATES_R2_BUCKET — bucket name on Cloudflare R2
 *   CLOUDFLARE_ACCOUNT_ID
 *   CLOUDFLARE_API_TOKEN
 *
 * Usage: node scripts/upload-crm-updates.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = join(root, "dist-crm-release");

if (!existsSync(artifactRoot)) {
  console.error("Run node scripts/release-crm-android.mjs first.");
  process.exit(1);
}

const bucket = process.env.UPDATES_R2_BUCKET?.trim();
if (!bucket || !process.env.CLOUDFLARE_API_TOKEN) {
  console.log("UPDATES_R2_BUCKET / CLOUDFLARE_API_TOKEN not set — skip upload.");
  console.log("See dist-crm-release/UPLOAD.md for manual copy to https://updates.tangodb.app");
  process.exit(0);
}

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

const files = walk(artifactRoot).filter((f) => f !== "UPLOAD.md" && f !== "landing-config.json");
for (const file of files) {
  const local = join(artifactRoot, file);
  const key = file.replace(/^android\//, "android/");
  const res = spawnSync(
    "npx",
    ["wrangler", "r2", "object", "put", `${bucket}/${key}`, "--file", local, "--remote"],
    { stdio: "inherit", shell: true, cwd: root }
  );
  if (res.status !== 0) process.exit(res.status ?? 1);
  console.log("Uploaded", key);
}

const landing = join(artifactRoot, "landing-config.json");
if (existsSync(landing)) {
  console.log("\nLanding patch:\n", readFileSync(landing, "utf8"));
}
