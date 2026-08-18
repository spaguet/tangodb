/**
 * Link calendar-imported personal lessons to tariffs and mark as paid.
 * Dry-run: node scripts/link-calendar-lesson-payments.mjs --dry-run
 * Apply:    node scripts/link-calendar-lesson-payments.mjs --apply
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { createSupabaseClient, loadEnv } from "./lib/import-common.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const orgId = process.argv.find((a, i) => process.argv[i - 1] === "--org-id") || "8da4b806-f9c8-49eb-8431-ec7e0a5390a1";
const dryRun = process.argv.includes("--dry-run");
const apply = process.argv.includes("--apply");

if (!dryRun && !apply) {
  console.error("Use --dry-run or --apply");
  process.exit(1);
}

const TARIFF_LABELS = {
  ballroomSoloKids: "Бальные Соло Дети",
  ballroomSoloAdults: "Бальные Соло Взрослые",
  ballroomPairKids: "Бальные Пара Дети",
  ballroomTrioKids: "Бальные Трио Дети",
  personalSolo: "Индивидуальный урок (1 человек)",
  personalPair: "Индивидуальный Парный Урок",
};

loadEnv();
const supabase = createSupabaseClient();

const mappingPath = resolve(root, ".import-mappings/calendar-import.json");
const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
const importedLessonIds = new Set(Object.values(mapping.ids.personal_lessons));
const ekaterinaId = mapping.ids.clients["client-ekaterina"];
const kristinaId = mapping.ids.clients["client-kristina"];

const { data: prices, error: pricesErr } = await supabase
  .from("prices")
  .select("id, label, price, type, category")
  .eq("organization_id", orgId);
if (pricesErr) throw pricesErr;

const tariffByLabel = {};
for (const p of prices ?? []) {
  if (p.label) tariffByLabel[p.label.trim()] = p;
}

for (const label of Object.values(TARIFF_LABELS)) {
  if (!tariffByLabel[label]) {
    console.error(`Missing tariff in DB: "${label}"`);
    process.exit(1);
  }
}

const { data: disciplines } = await supabase
  .from("disciplines")
  .select("id, name")
  .eq("organization_id", orgId);
const discById = Object.fromEntries((disciplines ?? []).map((d) => [d.id, d.name]));

const { data: clients } = await supabase
  .from("clients")
  .select("id, first_name, last_name")
  .eq("organization_id", orgId);
const clientDisplay = new Map(
  (clients ?? []).map((c) => [c.id, `${(c.last_name || "").trim()} ${(c.first_name || "").trim()}`.trim()])
);

const { data: existingPayments } = await supabase
  .from("payments")
  .select("personal_lesson_id")
  .eq("organization_id", orgId)
  .not("personal_lesson_id", "is", null);
const paidPlIds = new Set((existingPayments ?? []).map((p) => p.personal_lesson_id));

function resolveTariff(lesson) {
  const disc = discById[lesson.discipline_id] ?? "";

  if (disc === "СФП") {
    return tariffByLabel[TARIFF_LABELS.ballroomSoloKids];
  }

  if (disc === "Бальные танцы") {
    if (lesson.type === "solo") {
      if (lesson.client_id1 === ekaterinaId || lesson.client_id1 === kristinaId) {
        return tariffByLabel[TARIFF_LABELS.ballroomSoloAdults];
      }
      return tariffByLabel[TARIFF_LABELS.ballroomSoloKids];
    }
    if (lesson.type === "pair") return tariffByLabel[TARIFF_LABELS.ballroomPairKids];
    if (lesson.type === "trio") return tariffByLabel[TARIFF_LABELS.ballroomTrioKids];
    return { conflict: "ballroom_unsupported_type", disc, type: lesson.type };
  }

  if (disc === "Биомеханика танца") {
    return tariffByLabel[TARIFF_LABELS.personalSolo];
  }

  if (disc === "Танго") {
    if (lesson.type === "pair") return tariffByLabel[TARIFF_LABELS.personalPair];
    if (lesson.type === "solo") return tariffByLabel[TARIFF_LABELS.personalSolo];
    return { conflict: "tango_unsupported_type", disc, type: lesson.type };
  }

  return { conflict: "unknown_discipline", disc };
}

const lessons = [];
let from = 0;
const pageSize = 500;
while (true) {
  const { data, error } = await supabase
    .from("personal_lessons")
    .select("id, type, client_id1, client_id2, discipline_id, paid, price, date")
    .eq("organization_id", orgId)
    .gte("date", "2025-09-01")
    .order("date")
    .range(from, from + pageSize - 1);
  if (error) throw error;
  if (!data?.length) break;
  lessons.push(...data.filter((l) => importedLessonIds.has(l.id)));
  if (data.length < pageSize) break;
  from += pageSize;
}

const plan = [];
const conflicts = [];
const skipped = [];

for (const lesson of lessons) {
  if (paidPlIds.has(lesson.id)) {
    skipped.push({ id: lesson.id, reason: "already_has_payment" });
    continue;
  }

  const tariff = resolveTariff(lesson);
  if (tariff?.conflict) {
    conflicts.push({
      id: lesson.id,
      date: lesson.date,
      ...tariff,
      clients: [lesson.client_id1, lesson.client_id2].filter(Boolean).map((id) => clientDisplay.get(id)),
    });
    continue;
  }

  plan.push({
    lessonId: lesson.id,
    date: lesson.date,
    tariffLabel: tariff.label,
    tariffId: tariff.id,
    amount: Number(tariff.price),
    clientId: lesson.client_id1,
    clientDisplay: clientDisplay.get(lesson.client_id1) || "Клиент",
  });
}

const byTariff = {};
for (const row of plan) {
  byTariff[row.tariffLabel] = (byTariff[row.tariffLabel] ?? 0) + 1;
}

console.log(
  JSON.stringify(
    {
      mode: dryRun ? "dry-run" : "apply",
      importedLessonsInRange: lessons.length,
      toUpdate: plan.length,
      skipped: skipped.length,
      conflicts: conflicts.length,
      byTariff,
    },
    null,
    2
  )
);

if (conflicts.length) {
  console.log("\nConflicts (first 20):");
  console.log(JSON.stringify(conflicts.slice(0, 20), null, 2));
}

if (dryRun) {
  process.exit(conflicts.length ? 2 : 0);
}

if (conflicts.length) {
  console.error("Refusing apply while conflicts exist.");
  process.exit(1);
}

let opCounter = Date.now();
for (let i = 0; i < plan.length; i += 50) {
  const chunk = plan.slice(i, i + 50);
  const todo = chunk.filter((row) => !paidPlIds.has(row.lessonId));
  if (!todo.length) continue;

  for (const row of todo) {
    const { error: updErr } = await supabase
      .from("personal_lessons")
      .update({ price: row.amount, paid: "yes" })
      .eq("organization_id", orgId)
      .eq("id", row.lessonId);
    if (updErr) throw new Error(`update ${row.lessonId}: ${updErr.message}`);
  }

  const paymentRows = todo.map((row) => ({
    organization_id: orgId,
    client_id: row.clientId,
    client_display: row.clientDisplay,
    amount: row.amount,
    method: "cash",
    subscription_id: null,
    personal_lesson_id: row.lessonId,
    operation_kind: "payment",
    created_at: `${row.date}T12:00:00.000Z`,
    idempotency_key: randomUUID(),
    idempotency_scope: "calendar_import_payment",
  }));

  const { error: payErr } = await supabase.from("payments").insert(paymentRows);
  if (payErr) throw new Error(`payments batch ${i}: ${payErr.message}`);
  for (const row of todo) paidPlIds.add(row.lessonId);
  console.log(`Processed ${Math.min(i + 50, plan.length)} / ${plan.length} (batch +${todo.length})`);
}

console.log("Apply complete.");
