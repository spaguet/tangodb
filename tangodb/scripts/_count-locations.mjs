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

const orgId = process.argv[2];
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
const admin = createClient(url, key, { auth: { persistSession: false } });

const { data: locs } = await admin.from("locations").select("id,name").eq("organization_id", orgId);
const { count } = await admin
  .from("personal_lessons")
  .select("*", { count: "exact", head: true })
  .eq("organization_id", orgId);
const { count: discCount } = await admin
  .from("disciplines")
  .select("*", { count: "exact", head: true })
  .eq("organization_id", orgId);

console.log(JSON.stringify({ locations: locs, personalLessons: count, disciplines: discCount }, null, 2));
