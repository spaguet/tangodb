/**
 * Resolve DB conflicts per user decision:
 * - Delete Wed "Танго" group slot (+ Wed/Thu "Группа" slots that block individuals at 20:00)
 * - Import 24 remaining skipped lessons (not the 2 existing SFП duplicates)
 * - Fix Ksenia+Iván lesson as couple
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createSupabaseClient, insertBatch, loadEnv } from "./lib/import-common.mjs";
import { IdMappingStore } from "./lib/import-mapping.mjs";
import { resolveLocation } from "./lib/import-postprocess.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const orgId = process.argv[2] || "8da4b806-f9c8-49eb-8431-ec7e0a5390a1";

const SLOT_IDS_TO_DELETE = [
  "b57671cb-0956-4756-bc5e-a5a6b98cfdfe", // Wed Танго 20:00
  "b03ca52b-4f7e-4c87-b4c3-869aa3434afd", // Wed Группа 20:00
  "203136f2-9154-4ac7-810f-6b8f3f851825", // Thu Группа 20:00
];

const EXISTING_PERSONAL_SKIP = new Set([
  "472b3140-b077-4d75-a183-8aa2094eda32",
  "0e2427f2-1b76-4690-a2ca-5195f71b9cb7",
]);

const KSENIA_LESSON_ID = "978d6e70-5f01-45bb-a29d-4646474dba33";

loadEnv();
const supabase = createSupabaseClient();
const conflictsPath = resolve(root, "data/import/albertkoall/calendar_db_conflicts.json");
const inputPath = resolve(root, "data/import/albertkoall/calendar_personal_lessons.json");
const { conflictLessonIds } = JSON.parse(readFileSync(conflictsPath, "utf8"));
const data = JSON.parse(readFileSync(inputPath, "utf8"));

const importIds = conflictLessonIds.filter((id) => !EXISTING_PERSONAL_SKIP.has(id));
let lessons = data.personal_lessons.filter((l) => importIds.includes(l.externalId));

const ksenia = lessons.find((l) => l.externalId === KSENIA_LESSON_ID);
if (ksenia) {
  ksenia.type = "pair";
  ksenia.clientKeys = ["kseniya", "ivan"];
  ksenia.clientExternalIds = ["client-kseniya", "client-ivan"];
  ksenia.clients = [
    { key: "kseniya", first_name: "Ксения", last_name: "", display: "Ксения" },
    { key: "ivan", first_name: "Иван", last_name: "", display: "Иван" },
  ];
  ksenia.summary = "Танго - индив Ксения и Иван";
}

console.log(`Deleting ${SLOT_IDS_TO_DELETE.length} schedule slot(s)...`);
for (const id of SLOT_IDS_TO_DELETE) {
  const { error } = await supabase.from("schedule_slots").delete().eq("id", id).eq("organization_id", orgId);
  if (error) throw new Error(`delete slot ${id}: ${error.message}`);
  console.log(`  deleted ${id}`);
}

const loc = await resolveLocation(supabase, orgId, { locationName: "Miami studio" });
const mapping = new IdMappingStore({
  orgId,
  slug: "calendar-import",
  sourceFile: inputPath,
  sourceHash: "",
});

const rows = lessons.map((l) => {
  const disciplineId = mapping.mapOrCreate("disciplines", l.disciplineExternalId);
  const clientIds = l.clientExternalIds.map((ext) => mapping.mapOrCreate("clients", ext));
  return {
    id: mapping.mapOrCreate("personal_lessons", l.externalId),
    organization_id: orgId,
    type: l.type,
    client_id1: clientIds[0] ?? null,
    client_id2: clientIds[1] ?? null,
    client_id3: clientIds[2] ?? null,
    client_id4: clientIds[3] ?? null,
    date: l.date,
    time_start: l.time_start,
    time_end: l.time_end,
    price: l.price ?? 0,
    paid: l.paid ?? "no",
    discipline_id: disciplineId,
    location_id: loc.id,
  };
});

console.log(`Importing ${rows.length} personal lesson(s)...`);
await insertBatch(supabase, "personal_lessons", rows);
mapping.save();

console.log("Done.", { imported: rows.length, skippedDuplicates: EXISTING_PERSONAL_SKIP.size });
