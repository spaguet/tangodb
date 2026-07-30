/**
 * One-off: inspect / grant can_edit_past_schedule for a user email.
 * Env: .env.local — VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const email = (process.argv[2] || "albertkoall@gmail.com").toLowerCase();
const apply = process.argv.includes("--apply");

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
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersError) throw usersError;

  const user = users.users.find((u) => u.email?.toLowerCase() === email);
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  console.log("User:", user.id, user.email, user.app_metadata);

  const { data: members, error: membersError } = await admin
    .from("organization_members")
    .select("id, organization_id, role, meta, is_active, organizations(name, slug)")
    .eq("user_id", user.id);

  if (membersError) throw membersError;

  console.log("Memberships:", JSON.stringify(members, null, 2));

  if (!apply) {
    console.log("\nDry run. Pass --apply to set meta.can_edit_past_schedule = true");
    return;
  }

  if (!members?.length) {
    console.error("No organization memberships found");
    process.exit(1);
  }

  for (const member of members) {
    const meta = { ...(member.meta ?? {}), can_edit_past_schedule: true };
    const { error } = await admin
      .from("organization_members")
      .update({ meta })
      .eq("id", member.id);
    if (error) throw error;
    console.log(`Updated member ${member.id} (${member.organizations?.name ?? member.organization_id})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
