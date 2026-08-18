import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

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

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).slice(0, 5).split(":").map(Number);
  return h * 60 + m;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
function isoDowFromDate(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  return dow === 0 ? 7 : dow;
}

const orgId = process.argv[2];
const input = resolve(root, "data/import/albertkoall/calendar_personal_lessons.json");
const data = JSON.parse(readFileSync(input, "utf8"));
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(url, key);

const locationId = "77e22d5a-3420-4852-abbd-ebd8fd72d2dd";
const dates = data.personal_lessons.map((l) => l.date).sort();
const [{ data: existingPersonal }, { data: scheduleSlots }] = await Promise.all([
  supabase
    .from("personal_lessons")
    .select("id, date, time_start, time_end")
    .eq("organization_id", orgId)
    .gte("date", dates[0])
    .lte("date", dates.at(-1)),
  supabase.from("schedule_slots").select("*").eq("organization_id", orgId),
]);

const conflicts = [];
const conflictLessonIds = new Set();
for (const lesson of data.personal_lessons) {
  const start = toMinutes(lesson.time_start);
  const end = toMinutes(lesson.time_end);
  const dow = isoDowFromDate(lesson.date);
  let hit = false;
  for (const p of existingPersonal ?? []) {
    if (p.date !== lesson.date) continue;
    if (
      overlaps(start, end, toMinutes(p.time_start), toMinutes(p.time_end))
    ) {
      conflicts.push({ kind: "existing_personal", lesson: lesson.externalId, date: lesson.date, summary: lesson.summary });
      conflictLessonIds.add(lesson.externalId);
      hit = true;
      break;
    }
  }
  if (hit) continue;
  for (const slot of scheduleSlots ?? []) {
    if (slot.day_of_week !== dow) continue;
    if (slot.location_id !== locationId) continue;
    if (overlaps(start, end, toMinutes(slot.time), toMinutes(slot.time_end))) {
      conflicts.push({
        kind: "group_slot",
        lesson: lesson.externalId,
        date: lesson.date,
        summary: lesson.summary,
        slot: slot.group_name,
        time: `${slot.time}-${slot.time_end}`,
      });
      conflictLessonIds.add(lesson.externalId);
      break;
    }
  }
}

const byKind = {};
for (const c of conflicts) byKind[c.kind] = (byKind[c.kind] || 0) + 1;

console.log(
  JSON.stringify(
    {
      totalLessons: data.personal_lessons.length,
      conflictingLessons: conflictLessonIds.size,
      importable: data.personal_lessons.length - conflictLessonIds.size,
      conflictRecords: conflicts.length,
      byKind,
      samples: conflicts.slice(0, 5),
    },
    null,
    2
  )
);

writeFileSync(
  resolve(root, "data/import/albertkoall/calendar_db_conflicts.json"),
  JSON.stringify({ conflictLessonIds: [...conflictLessonIds], conflicts }, null, 2)
);
