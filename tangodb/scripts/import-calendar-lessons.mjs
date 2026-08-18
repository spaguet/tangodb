/**
 * Import calendar_personal_lessons.json into an organization.
 *
 * Prerequisites: disciplines and clients should exist (or will be created).
 *
 * Usage:
 *   node scripts/import-calendar-lessons.mjs --dry-run --org-id UUID --input data/import/albertkoall/calendar_personal_lessons.json
 *   node scripts/import-calendar-lessons.mjs --apply --org-id UUID --input ... --default-location-name "Miami studio"
 */
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  parseArgs,
  createSupabaseClient,
  insertBatch,
} from "./lib/import-common.mjs";
import { IdMappingStore } from "./lib/import-mapping.mjs";
import { resolveLocation } from "./lib/import-postprocess.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnv() {
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
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

async function loadExistingPersonal(supabase, orgId, minDate, maxDate) {
  const { data, error } = await supabase
    .from("personal_lessons")
    .select("id, date, time_start, time_end, location_id")
    .eq("organization_id", orgId)
    .gte("date", minDate)
    .lte("date", maxDate);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadScheduleSlots(supabase, orgId) {
  const { data, error } = await supabase
    .from("schedule_slots")
    .select("id, day_of_week, time, time_end, group_name, location_id")
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function isoDowFromDate(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function findConflicts(lessons, existingPersonal, scheduleSlots, locationId) {
  const conflicts = [];
  for (const lesson of lessons) {
    const start = toMinutes(lesson.time_start);
    const end = toMinutes(lesson.time_end);
    const dow = isoDowFromDate(lesson.date);

    for (const p of existingPersonal) {
      if (p.date !== lesson.date) continue;
      if (locationId && p.location_id && p.location_id !== locationId) continue;
      if (
        overlaps(
          start,
          end,
          toMinutes(p.time_start),
          toMinutes(p.time_end)
        )
      ) {
        conflicts.push({ kind: "existing_personal", lesson, existing: p });
      }
    }

    for (const slot of scheduleSlots) {
      if (slot.day_of_week !== dow) continue;
      if (locationId && slot.location_id && slot.location_id !== locationId) continue;
      if (
        overlaps(
          start,
          end,
          toMinutes(slot.time),
          toMinutes(slot.time_end)
        )
      ) {
        conflicts.push({ kind: "group_slot", lesson, slot });
      }
    }
  }
  return conflicts;
}

async function loadExistingDisciplines(supabase, orgId) {
  const { data, error } = await supabase
    .from("disciplines")
    .select("id, name")
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

function seedDisciplineMappingsFromDb(disciplines, existingDisciplines, mapping) {
  const byName = new Map(existingDisciplines.map((d) => [d.name.trim().toLowerCase(), d.id]));
  for (const d of disciplines) {
    const existingId = byName.get(d.name.trim().toLowerCase());
    if (existingId) mapping.setUuid("disciplines", d.externalId, existingId);
  }
}

async function ensureDisciplines(supabase, orgId, disciplines, mapping) {
  const existingDisciplines = await loadExistingDisciplines(supabase, orgId);
  seedDisciplineMappingsFromDb(disciplines, existingDisciplines, mapping);

  const rows = disciplines.map((d) => ({
    id: mapping.mapOrCreate("disciplines", d.externalId),
    organization_id: orgId,
    name: d.name,
    description: d.description ?? "",
  }));

  if (!rows.length) return rows;

  const { error } = await supabase.from("disciplines").upsert(rows, {
    onConflict: "organization_id,id",
    ignoreDuplicates: false,
  });
  if (error) throw new Error(`disciplines: ${error.message}`);
  return rows;
}

async function ensureClients(supabase, orgId, clients, mapping) {
  const rows = clients.map((c) => ({
    id: mapping.mapOrCreate("clients", c.externalId),
    organization_id: orgId,
    first_name: c.first_name,
    last_name: c.last_name ?? "",
    telegram: c.telegram ?? "",
  }));

  if (!rows.length) return rows;

  const { error } = await supabase.from("clients").upsert(rows, {
    onConflict: "organization_id,id",
    ignoreDuplicates: false,
  });
  if (error) throw new Error(`clients: ${error.message}`);
  return rows;
}

function buildPersonalLessonRows(data, orgId, mapping, locationId) {
  return data.personal_lessons.map((l) => {
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
      location_id: locationId,
    };
  });
}

function findInternalConflicts(lessons) {
  const conflicts = [];
  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const a = lessons[i];
      const b = lessons[j];
      if (a.date !== b.date) continue;
      if (
        overlaps(
          toMinutes(a.time_start),
          toMinutes(a.time_end),
          toMinutes(b.time_start),
          toMinutes(b.time_end)
        )
      ) {
        conflicts.push({ kind: "ics_overlap", a, b });
      }
    }
  }
  return conflicts;
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv);

  if (!args.orgId || !args.input) {
    console.error("Required: --org-id and --input");
    process.exit(1);
  }

  const inputPath = resolve(process.cwd(), args.input);
  const data = JSON.parse(readFileSync(inputPath, "utf8"));
  const slug = args.slug ?? "calendar-import";

  console.log(`Import calendar personal lessons (${data.personal_lessons.length} rows)`);
  console.log(`Org: ${args.orgId}`);
  console.log(`Mode: ${args.dryRun ? "dry-run" : "apply"}`);

  const mapping = new IdMappingStore({
    orgId: args.orgId,
    slug,
    sourceFile: inputPath,
    sourceHash: "",
  });

  let locationId = args.defaultLocationId ?? null;
  let existingPersonal = [];
  let scheduleSlots = [];

  if (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) {
    const supabase = createSupabaseClient();
    if (args.defaultLocationName || args.defaultLocationId) {
      const loc = await resolveLocation(supabase, args.orgId, {
        locationId: args.defaultLocationId,
        locationName: args.defaultLocationName,
      });
      locationId = loc.id;
      console.log(`Location: ${loc.name} (${loc.id})`);
    }

    const dates = data.personal_lessons.map((l) => l.date).sort();
    existingPersonal = await loadExistingPersonal(
      supabase,
      args.orgId,
      dates[0],
      dates[dates.length - 1]
    );
    scheduleSlots = await loadScheduleSlots(supabase, args.orgId);

    const existingDisciplines = await loadExistingDisciplines(supabase, args.orgId);
    seedDisciplineMappingsFromDb(data.disciplines, existingDisciplines, mapping);
  }

  const skipDbConflicts = args.skipDbConflicts;
  const internalConflicts = findInternalConflicts(data.personal_lessons);
  const conflicts = findConflicts(
    data.personal_lessons,
    existingPersonal,
    scheduleSlots,
    locationId
  );
  const conflictLessonIds = new Set(conflicts.map((c) => c.lesson.externalId));
  let lessonsToImport = data.personal_lessons;

  if (skipDbConflicts && conflictLessonIds.size) {
    lessonsToImport = data.personal_lessons.filter((l) => !conflictLessonIds.has(l.externalId));
    const skippedPath = resolve(root, "data/import/albertkoall/calendar_db_skipped.json");
    writeFileSync(
      skippedPath,
      JSON.stringify(
        {
          skippedCount: conflictLessonIds.size,
          reason: "db_conflict",
          lessons: conflicts.map((c) => ({
            kind: c.kind,
            externalId: c.lesson.externalId,
            date: c.lesson.date,
            time_start: c.lesson.time_start,
            time_end: c.lesson.time_end,
            summary: c.lesson.summary ?? null,
            slot: c.slot?.group_name ?? null,
          })),
        },
        null,
        2
      )
    );
    console.log(
      `\nSkipping ${conflictLessonIds.size} lesson(s) with DB conflicts → ${skippedPath}`
    );
  }

  const importData = { ...data, personal_lessons: lessonsToImport };
  const lessonRows = buildPersonalLessonRows(importData, args.orgId, mapping, locationId);

  console.log(
    JSON.stringify(
      {
        disciplines: data.disciplines.length,
        clients: data.clients.length,
        personalLessons: lessonRows.length,
        personalLessonsTotal: data.personal_lessons.length,
        skippedDbConflicts: skipDbConflicts ? conflictLessonIds.size : 0,
        existingPersonalInRange: existingPersonal.length,
        scheduleSlots: scheduleSlots.length,
        icsInternalOverlaps: internalConflicts.length,
        dbConflicts: conflicts.length,
      },
      null,
      2
    )
  );

  if (internalConflicts.length) {
    console.log("\nICS internal overlaps (first 10):");
    console.log(JSON.stringify(internalConflicts.slice(0, 10), null, 2));
  }

  if (conflicts.length) {
    console.log("\nDB conflicts (first 15):");
    console.log(JSON.stringify(conflicts.slice(0, 15), null, 2));
  }

  if (args.dryRun) {
    console.log("\nDry-run complete.");
    const hasBlocking =
      internalConflicts.length || (conflicts.length && !skipDbConflicts);
    process.exit(hasBlocking ? 2 : 0);
  }

  const supabase = createSupabaseClient();
  if (!locationId) {
    console.error("Apply requires --default-location-name or --default-location-id");
    process.exit(1);
  }

  if (internalConflicts.length) {
    console.warn(
      `Warning: ${internalConflicts.length} overlap(s) inside ICS data (see calendar_conflicts.json). Apply continues if no DB conflicts.`
    );
  }

  if (conflicts.length && !skipDbConflicts) {
    console.error(
      "Refusing apply while DB conflicts exist. Use --skip-db-conflicts to exclude conflicting lessons."
    );
    process.exit(1);
  }

  await ensureDisciplines(supabase, args.orgId, data.disciplines, mapping);
  await ensureClients(supabase, args.orgId, data.clients, mapping);
  await insertBatch(supabase, "personal_lessons", lessonRows);
  mapping.save();

  console.log(
    `\nApply complete. Imported ${lessonRows.length} personal lesson(s).`
  );
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
