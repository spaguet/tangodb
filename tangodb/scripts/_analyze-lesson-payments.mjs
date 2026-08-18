import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.local", ".env.migrate", ".env"]) {
  const p = resolve(root, name);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[k]) process.env[k] = v;
  }
}

const org = process.argv[2] || "8da4b806-f9c8-49eb-8431-ec7e0a5390a1";
const sb = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const mapping = JSON.parse(
  readFileSync(resolve(root, ".import-mappings/calendar-import.json"), "utf8")
);
const importedLessonIds = new Set(Object.values(mapping.ids.personal_lessons));

const { data: prices } = await sb
  .from("prices")
  .select("id, label, type, lessons, price, category, discipline_id")
  .eq("organization_id", org)
  .order("label");

console.log("PRICES:");
for (const p of prices ?? []) {
  console.log(`  ${p.label} | ${p.type} | ${p.price} | id=${p.id}`);
}

const { data: disciplines } = await sb.from("disciplines").select("id, name").eq("organization_id", org);
const discById = Object.fromEntries((disciplines ?? []).map((d) => [d.id, d.name]));

const { data: clients } = await sb.from("clients").select("id, first_name, last_name").eq("organization_id", org);
const clientById = Object.fromEntries(
  (clients ?? []).map((c) => [c.id, `${c.first_name} ${c.last_name}`.trim()])
);

const ekaterinaId = mapping.ids.clients["client-ekaterina"];
const kristinaId = mapping.ids.clients["client-kristina"];

const { data: lessons } = await sb
  .from("personal_lessons")
  .select("id, type, client_id1, client_id2, discipline_id, paid, price, date")
  .eq("organization_id", org)
  .in("id", [...importedLessonIds]);

const stats = { solo: 0, pair: 0, trio: 0, quad: 0, paid: 0, unpaid: 0 };
const byDisc = {};
const ballroomNonSolo = [];
const unknown = [];

for (const l of lessons ?? []) {
  stats[l.type] = (stats[l.type] ?? 0) + 1;
  if (l.paid === "yes") stats.paid++;
  else stats.unpaid++;

  const dname = discById[l.discipline_id] ?? "?";
  byDisc[dname] = (byDisc[dname] ?? 0) + 1;

  if (dname === "Бальные танцы" && l.type !== "solo") {
    ballroomNonSolo.push({ id: l.id, type: l.type, clients: [l.client_id1, l.client_id2].map((id) => clientById[id]) });
  }
}

console.log("\nIMPORTED LESSONS:", lessons?.length);
console.log("stats:", stats);
console.log("by discipline:", byDisc);
console.log("ekaterinaId", ekaterinaId, "kristinaId", kristinaId);
if (ballroomNonSolo.length) {
  console.log("\nBALLROOM NON-SOLO (" + ballroomNonSolo.length + "):");
  console.log(JSON.stringify(ballroomNonSolo.slice(0, 10), null, 2));
}
