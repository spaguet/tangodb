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

const org = process.argv[2];
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const tables = ["clients", "disciplines", "personal_lessons"];
for (const t of tables) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true }).eq("organization_id", org);
  if (error) throw error;
  console.log(`${t}: ${count}`);
}

const { data: clients } = await sb.from("clients").select("id, first_name, last_name").eq("organization_id", org);
console.log("client names:", clients?.map((c) => `${c.first_name} ${c.last_name}`.trim()).join(", "));
