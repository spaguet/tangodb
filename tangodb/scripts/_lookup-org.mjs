import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.local", ".env.migrate", ".env"]) {
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

const email = (process.argv[2] || "albertkoall@gmail.com").toLowerCase();
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
  process.exit(1);
}

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: users, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (error) throw error;

const user = users.users.find((u) => u.email?.toLowerCase() === email);
if (!user) {
  console.error(`User not found: ${email}`);
  process.exit(1);
}

const { data: members, error: mErr } = await admin
  .from("organization_members")
  .select("organization_id, role, organizations(id, name, slug, status)")
  .eq("user_id", user.id);
if (mErr) throw mErr;

console.log(JSON.stringify({ userId: user.id, memberships: members }, null, 2));
