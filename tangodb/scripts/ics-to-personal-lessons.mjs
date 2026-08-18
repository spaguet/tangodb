/**
 * Parse Google Calendar ICS export → personal lessons JSON for TangoDB import.
 *
 * Usage:
 *   node scripts/ics-to-personal-lessons.mjs path/to/calendar.ics
 *   node scripts/ics-to-personal-lessons.mjs path/to/calendar.ics --since 2025-09-01 --out data/import/albertkoall/calendar_personal_lessons.json
 *   node scripts/ics-to-personal-lessons.mjs ... --check-conflicts --org-id UUID
 */
import { createHash, randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const TZ_OFFSET_MINUTES = 7 * 60; // Asia/Bangkok (calendar X-WR-TIMEZONE)

const BALLROOM_GROUP_RE =
  /silver|gold|bronze|продолжающ|начинающ|средн|пары|вьетнам|vietnam|vietnamese|silver|gold|bronze/i;

const TANGO_GROUP_RE =
  /практикум|танготрен|треня|master|мк\b|workshop|фestival|фестив/i;

/** Canonical client identity — aliases from calendar → CRM name */
const CLIENT_CANONICAL = [
  { match: /^(алиса\s*ч\.?|алиса)$/i, first_name: "Алиса", last_name: "Чакур", key: "alisa-chakur" },
  { match: /^алиса\s*к\.?$/i, first_name: "Алиса", last_name: "Кононова", key: "alisa-kononova" },
  { match: /^алиса\s+кононова$/i, first_name: "Алиса", last_name: "Кононова", key: "alisa-kononova" },
  { match: /^ева\s*в\.?$/i, first_name: "Ева", last_name: "Вильданова", key: "eva-vildanova" },
  { match: /^ева$/i, first_name: "Ева", last_name: "Петрова", key: "eva-petrova" },
  { match: /^(саломея|соломея)$/i, first_name: "Соломея", last_name: "", key: "solomeya" },
  { match: /^(сона|соня)$/i, first_name: "Соня", last_name: "", key: "sonya" },
  { match: /^(настя|анастасия)$/i, first_name: "Анастасия", last_name: "", key: "anastasia" },
  { match: /^лиза$/i, first_name: "Лиза", last_name: "", key: "liza" },
];

const CYRILLIC_SLUG = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugifyToken(value) {
  const lower = value.toLowerCase();
  let out = "";
  for (const ch of lower) {
    if (CYRILLIC_SLUG[ch] != null) out += CYRILLIC_SLUG[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (ch === " " || ch === "-") out += "-";
  }
  return out.replace(/-+/g, "-").replace(/^-|-$/g, "") || "client";
}

function slugClientKey(firstName, lastName) {
  return slugifyToken(`${firstName}-${lastName}`.trim()) || "client";
}

const DISCIPLINE_META = {
  ballroom_individual: { externalId: "discipline-ballroom", name: "Бальные танцы" },
  tango_individual: { externalId: "discipline-tango", name: "Танго" },
  biomechanics_individual: { externalId: "discipline-biomechanics", name: "Биомеханика танца" },
  sfp_individual: { externalId: "discipline-sfp", name: "СФП" },
};

function resolveClient(rawName) {
  const token = normalizeClientToken(rawName);
  const lower = token.toLowerCase();
  for (const rule of CLIENT_CANONICAL) {
    if (rule.match.test(lower)) {
      return { first_name: rule.first_name, last_name: rule.last_name, key: rule.key };
    }
  }
  return {
    first_name: token,
    last_name: "",
    key: slugClientKey(token, ""),
  };
}

function resolveClientNames(rawNames) {
  const seen = new Set();
  const resolved = [];
  for (const raw of rawNames) {
    const client = resolveClient(raw);
    if (seen.has(client.key)) continue;
    seen.add(client.key);
    resolved.push(client);
  }
  return resolved;
}

function displayName(client) {
  return client.last_name ? `${client.first_name} ${client.last_name}` : client.first_name;
}

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

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function unfoldIcs(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");
}

function parseIcsEvents(icsText) {
  const unfolded = unfoldIcs(icsText);
  const events = [];
  const blocks = unfolded.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0];
    const lines = block.split("\n").filter(Boolean);
    const fields = {};
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const rawKey = line.slice(0, idx);
      const value = line.slice(idx + 1).trim();
      const key = rawKey.split(";")[0];
      if (!fields[key]) fields[key] = [];
      fields[key].push({ rawKey, value });
    }
    const summary = fields.SUMMARY?.[0]?.value ?? "";
    events.push({
      uid: fields.UID?.[0]?.value ?? randomUUID(),
      summary: summary.replace(/\\,/g, ",").replace(/\\n/g, "\n"),
      dtstart: fields.DTSTART?.[0] ?? null,
      dtend: fields.DTEND?.[0] ?? null,
      rrule: fields.RRULE?.[0]?.value ?? null,
      exdate: (fields.EXDATE ?? []).map((x) => x.value),
      status: fields.STATUS?.[0]?.value ?? "CONFIRMED",
    });
  }
  return events;
}

function parseIcsDateTime(dtField) {
  if (!dtField) return null;
  const { rawKey, value } = dtField;
  const isDateOnly = rawKey.includes("VALUE=DATE") && !rawKey.includes("VALUE=DATE-TIME");

  if (isDateOnly || /^\d{8}$/.test(value)) {
    const y = +value.slice(0, 4);
    const m = +value.slice(4, 6) - 1;
    const d = +value.slice(6, 8);
    return { utcMs: Date.UTC(y, m, d), isDateOnly: true };
  }

  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;

  const y = +m[1];
  const mo = +m[2] - 1;
  const d = +m[3];
  const hh = +m[4];
  const mm = +m[5];
  const ss = +m[6];
  const isUtc = m[7] === "Z" || !rawKey.includes("TZID=");

  if (isUtc) {
    return { utcMs: Date.UTC(y, mo, d, hh, mm, ss), isDateOnly: false };
  }

  // Floating local time in Bangkok (+7)
  const localAsUtc = Date.UTC(y, mo, d, hh, mm, ss) - TZ_OFFSET_MINUTES * 60_000;
  return { utcMs: localAsUtc, isDateOnly: false };
}

function bangkokParts(utcMs) {
  const local = new Date(utcMs + TZ_OFFSET_MINUTES * 60_000);
  return {
    date: local.toISOString().slice(0, 10),
    time: local.toISOString().slice(11, 16),
    dow: local.getUTCDay(), // 0 Sun .. 6 Sat; Tue=2 Fri=5
  };
}

function addDaysUtc(utcMs, days) {
  return utcMs + days * 86_400_000;
}

function parseRrule(rrule) {
  const parts = Object.fromEntries(
    rrule.split(";").map((p) => {
      const [k, v] = p.split("=");
      return [k, v];
    })
  );
  return parts;
}

function expandOccurrences(event, sinceMs, untilMs = Date.UTC(2027, 11, 31)) {
  const start = parseIcsDateTime(event.dtstart);
  if (!start) return [];

  let end = parseIcsDateTime(event.dtend);
  let durationMs = 3_600_000;
  if (end && !end.isDateOnly && !start.isDateOnly) {
    durationMs = Math.max(end.utcMs - start.utcMs, 30 * 60_000);
  } else if (start.isDateOnly) {
    durationMs = 86_400_000;
  }

  const exdates = new Set(
    (event.exdate ?? [])
      .flatMap((raw) => raw.split(","))
      .map((part) => {
        const dt = parseIcsDateTime({ rawKey: "DTSTART", value: part.trim() });
        return dt ? bangkokParts(dt.utcMs).date : null;
      })
      .filter(Boolean)
  );

  const occ = [];
  const pushOcc = (utcMs) => {
    if (utcMs < sinceMs || utcMs > untilMs) return;
    const { date } = bangkokParts(utcMs);
    if (exdates.has(date)) return;
    occ.push({
      uid: event.uid,
      summary: event.summary,
      utcStart: utcMs,
      utcEnd: utcMs + durationMs,
    });
  };

  if (!event.rrule) {
    pushOcc(start.utcMs);
    return occ;
  }

  const rule = parseRrule(event.rrule);
  if (rule.FREQ !== "WEEKLY") {
    pushOcc(start.utcMs);
    return occ;
  }

  const interval = rule.INTERVAL ? parseInt(rule.INTERVAL, 10) : 1;
  let until = untilMs;
  if (rule.UNTIL) {
    const u = parseIcsDateTime({ rawKey: "DTSTART:Z", value: rule.UNTIL.replace(/Z$/, "Z") });
    if (u) until = Math.min(until, u.utcMs);
  }

  let cur = start.utcMs;
  let guard = 0;
  while (cur <= until && guard < 400) {
    pushOcc(cur);
    cur = addDaysUtc(cur, 7 * interval);
    guard++;
  }
  return occ;
}

function normalizeSummary(summary) {
  return summary.trim().replace(/\s+/g, " ");
}

function extractClientNames(summary) {
  const s = normalizeSummary(summary);
  const patterns = [
    /бальный\s+индив\s*-\s*(.+)$/i,
    /индив\.?\s+(.+)$/i,
    /-\s*индив\s+(.+)$/i,
    /-\s*индив\s*(.+)$/i,
    /индив\s*-\s*танго\s+(.+)$/i,
    /танго\s*-\s*индив\s+(.+)$/i,
    /индив\s+пары\s*-\s*танго\s+(.+)$/i,
    /индив\s+пары\s+(.+)$/i,
    /^СФП\s*-\s*индив\s+(.+)$/i,
    /^Сальса\s+индив\s*-\s*(.+)$/i,
  ];

  for (const re of patterns) {
    const m = s.match(re);
    if (m?.[1]) {
      return splitNames(m[1]);
    }
  }

  // "Бальные - Аня и Лиза" (no explicit индив)
  const m2 = s.match(/^Бальные\s*-\s*(.+)$/i);
  if (m2 && !BALLROOM_GROUP_RE.test(m2[1]) && !/группа/i.test(m2[1])) {
    const chunk = m2[1].trim();
    if (/[А-ЯЁA-Z][а-яёa-z]/.test(chunk)) return splitNames(chunk);
  }

  return [];
}

function splitNames(chunk) {
  const cleaned = chunk
    .replace(/\s+0[,.]5\s*урок.*$/i, "")
    .replace(/\s+и\s+партн[её]р.*/i, " и партнёр")
    .replace(/\s+в\s+центре.*/i, "")
    .replace(/\s+в\s+КДЦ.*/i, "")
    .replace(/\s+у\s+.+$/i, "")
    .replace(/^-\s*/, "")
    .trim();

  if (!cleaned || /^(танго|бальные?)$/i.test(cleaned)) return [];
  if (/^пары$/i.test(cleaned)) return [];

  const parts = cleaned
    .split(/\s*,\s*|\s+и\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/^партн[её]р$/i.test(p));
  return parts.map(normalizeClientToken).filter(Boolean);
}

function normalizeClientToken(name) {
  return name
    .replace(/\.$/, "")
    .replace(/\s+Ч\.?$/i, " Ч.")
    .replace(/\s+/g, " ")
    .trim();
}

function lessonTypeFromNames(names) {
  if (names.length >= 4) return "quad";
  if (names.length === 3) return "trio";
  if (names.length === 2) return "pair";
  if (names.length === 1) return "solo";
  return "solo";
}

function matchesKeywords(summary) {
  const s = summary.toLowerCase();
  return (
    s.includes("бальн") ||
    s.includes("индив") ||
    s.includes("танго") ||
    s.includes("биомеханик") ||
    s.includes("сальса") ||
    s.includes("сфп")
  );
}

function isBallroomIndividual(summary) {
  const s = normalizeSummary(summary);
  const lower = s.toLowerCase();
  if (!lower.includes("бальн")) return false;
  if (/группа/i.test(lower)) return false;
  if (/индив\s+пары\b/i.test(lower) || /-\s*индив\s+пары\b/i.test(lower)) return false;
  if (BALLROOM_GROUP_RE.test(lower)) return false;
  if (lower.includes("индив") || lower.includes("бальный индив")) return true;
  const names = extractClientNames(s);
  return names.length > 0;
}

function isTangoIndividual(summary, occ) {
  const s = normalizeSummary(summary);
  const lower = s.toLowerCase();
  if (!lower.includes("танго")) return false;
  if (TANGO_GROUP_RE.test(lower)) return false;

  const hasIndivMarker = /индив/i.test(lower);
  const names = extractClientNames(s);

  if (hasIndivMarker || names.length > 0) {
    // Exclude generic placeholders without a person name
    if (/^индив\s*-\s*танго$/i.test(s)) return false;
    if (/^танго\s*-\s*индив$/i.test(s)) return false;
    if (/^индив\s*-\s*танго\s*$/i.test(s)) return false;
    if (hasIndivMarker && names.length === 0 && /индив\s*-\s*танго\s*$/i.test(s)) return false;
    return names.length > 0 || hasIndivMarker;
  }

  // Group heuristic: plain "Танго" on Tue/Fri 20:00
  const { time, dow } = bangkokParts(occ.utcStart);
  if (/^танго$/i.test(s)) {
    if ((dow === 2 || dow === 5) && time === "20:00") return false;
    return false;
  }

  // Other tango events without indiv/names → group/special
  return false;
}

function isBiomechanicsIndividual(summary) {
  const lower = normalizeSummary(summary).toLowerCase();
  if (lower.includes("биомеханик")) {
    return /индив/i.test(lower) && extractClientNames(summary).length > 0;
  }
  return isSalsaLisaBiomechanics(summary);
}

/** Сальса индив с Лизой → та же дисциплина, что биомеханика (Анастасия) */
function isSalsaLisaBiomechanics(summary) {
  const lower = normalizeSummary(summary).toLowerCase();
  if (!lower.includes("сальса") || !/индив/i.test(lower)) return false;
  const clients = resolveClientNames(extractClientNames(summary));
  return clients.length > 0 && clients.every((c) => c.key === "liza");
}

function isSalsaIndividual(summary) {
  const lower = normalizeSummary(summary).toLowerCase();
  if (!lower.includes("сальса")) return false;
  if (!/индив/i.test(lower)) return false;
  if (isSalsaLisaBiomechanics(summary)) return false;
  return extractClientNames(summary).length > 0;
}

function isSfpIndividual(summary) {
  const lower = normalizeSummary(summary).toLowerCase();
  if (!lower.includes("сфп")) return false;
  return /индив/i.test(lower) && extractClientNames(summary).length > 0;
}

function disciplineForCategory(category) {
  return DISCIPLINE_META[category]?.name ?? category;
}

function disciplineExternalId(category) {
  return DISCIPLINE_META[category]?.externalId ?? `discipline-${category}`;
}

function clientExternalId(clientKey) {
  return `client-${clientKey}`;
}

function categorizeEvent(summary, occ) {
  if (isBallroomIndividual(summary)) return "ballroom_individual";
  if (isTangoIndividual(summary, occ)) return "tango_individual";
  if (isBiomechanicsIndividual(summary)) return "biomechanics_individual";
  if (isSalsaIndividual(summary)) return "salsa_individual";
  if (isSfpIndividual(summary)) return "sfp_individual";
  return null;
}

function stableLessonId(uid, date, timeStart, summary) {
  const hash = createHash("sha1")
    .update(`${uid}|${date}|${timeStart}|${normalizeSummary(summary)}`)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function dedupeKey(lesson) {
  const clients = [...lesson.clientKeys].sort().join("|");
  return `${lesson.category}|${lesson.date}|${lesson.time_start}|${lesson.time_end}|${clients}`;
}

function pickPreferredLesson(existing, candidate) {
  return lessonPreferenceScore(candidate) > lessonPreferenceScore(existing) ? candidate : existing;
}

function lessonPreferenceScore(l) {
  const duration = toMinutes(l.time_end) - toMinutes(l.time_start);
  return l.clients.length * 1000 + duration * 10 + l.summary.length;
}

function clientsOverlap(a, b) {
  const setB = new Set(b.clientKeys);
  return a.clientKeys.some((k) => setB.has(k));
}

function isClientSubset(sub, sup) {
  return sub.clientKeys.length < sup.clientKeys.length && sub.clientKeys.every((k) => sup.clientKeys.includes(k));
}

function summarizeLesson(l) {
  return {
    externalId: l.externalId,
    summary: l.summary,
    discipline: l.disciplineName,
    clients: l.clients.map((c) => c.display).join(", "),
    date: l.date,
    time: `${l.time_start}–${l.time_end}`,
  };
}

function resolveScheduleOverlaps(lessons) {
  const removed = [];
  let current = [...lessons];
  let changed = true;

  while (changed) {
    changed = false;
    outer: for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i];
        const b = current[j];
        if (a.date !== b.date) continue;
        if (
          !timeRangesOverlap(
            toMinutes(a.time_start),
            toMinutes(a.time_end),
            toMinutes(b.time_start),
            toMinutes(b.time_end)
          )
        ) {
          continue;
        }

        const sameClient = clientsOverlap(a, b);
        const sameUid = a.calendarUid === b.calendarUid;
        const subset = isClientSubset(a, b) || isClientSubset(b, a);

        if (sameClient || sameUid || subset) {
          const keep = pickPreferredLesson(a, b);
          const drop = keep.externalId === a.externalId ? b : a;
          removed.push({
            reason: sameClient
              ? "same_client_overlap"
              : sameUid
                ? "same_calendar_uid_overlap"
                : "client_subset_overlap",
            kept: summarizeLesson(keep),
            dropped: summarizeLesson(drop),
          });
          current = current.filter((l) => l.externalId !== drop.externalId);
          changed = true;
          break outer;
        }
      }
    }
  }

  const unresolved = [];
  for (let i = 0; i < current.length; i++) {
    for (let j = i + 1; j < current.length; j++) {
      const a = current[i];
      const b = current[j];
      if (a.date !== b.date) continue;
      if (
        timeRangesOverlap(
          toMinutes(a.time_start),
          toMinutes(a.time_end),
          toMinutes(b.time_start),
          toMinutes(b.time_end)
        )
      ) {
        unresolved.push({
          kind: "cross_client_overlap",
          date: a.date,
          a: summarizeLesson(a),
          b: summarizeLesson(b),
        });
      }
    }
  }

  return { lessons: current, removed, unresolved };
}

function loadManualResolutions(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { excludeExternalIds: [], timeAdjustments: [] };
  }
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function applyManualResolutions(lessons, resolutions) {
  const exclude = new Set(resolutions.excludeExternalIds ?? []);
  const adjustments = new Map(
    (resolutions.timeAdjustments ?? []).map((a) => [a.externalId, a])
  );
  const excluded = [];
  const adjusted = [];

  const result = lessons
    .filter((l) => {
      if (!exclude.has(l.externalId)) return true;
      excluded.push(summarizeLesson(l));
      return false;
    })
    .map((l) => {
      const patch = adjustments.get(l.externalId);
      if (!patch) return l;
      if (patch.date && patch.date !== l.date) return l;
      adjusted.push({
        externalId: l.externalId,
        summary: l.summary,
        date: l.date,
        from: `${l.time_start}–${l.time_end}`,
        to: `${patch.time_start}–${patch.time_end}`,
        note: patch.note ?? null,
      });
      return {
        ...l,
        time_start: patch.time_start,
        time_end: patch.time_end,
      };
    });

  return { lessons: result, excluded, adjusted };
}

function collectUnresolvedOverlaps(lessons) {
  const unresolved = [];
  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const a = lessons[i];
      const b = lessons[j];
      if (a.date !== b.date) continue;
      if (
        timeRangesOverlap(
          toMinutes(a.time_start),
          toMinutes(a.time_end),
          toMinutes(b.time_start),
          toMinutes(b.time_end)
        )
      ) {
        unresolved.push({
          kind: "cross_client_overlap",
          date: a.date,
          a: summarizeLesson(a),
          b: summarizeLesson(b),
        });
      }
    }
  }
  return unresolved;
}

function dedupeLessons(lessons) {
  const byClients = new Map();
  for (const lesson of lessons) {
    const key = dedupeKey(lesson);
    const prev = byClients.get(key);
    byClients.set(key, prev ? pickPreferredLesson(prev, lesson) : lesson);
  }

  const bySlot = new Map();
  for (const lesson of byClients.values()) {
    const slotKey = `${lesson.category}|${lesson.date}|${lesson.time_start}|${lesson.time_end}`;
    const prev = bySlot.get(slotKey);
    bySlot.set(slotKey, prev ? pickPreferredLesson(prev, lesson) : lesson);
  }

  return [...bySlot.values()].sort((a, b) =>
    `${a.date}${a.time_start}`.localeCompare(`${b.date}${b.time_start}`)
  );
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function buildExport(occurrences, sinceDate, manualResolutionsPath) {
  const sinceMs = Date.parse(`${sinceDate}T00:00:00.000Z`) - TZ_OFFSET_MINUTES * 60_000;

  const lessons = [];
  const skipped = [];

  for (const event of occurrences) {
    if (!matchesKeywords(event.summary)) continue;
    for (const occ of expandOccurrences(event, sinceMs)) {
      const { date, time: timeStart } = bangkokParts(occ.utcStart);
      const timeEnd = bangkokParts(occ.utcEnd).time;

      let category = categorizeEvent(event.summary, occ);
      if (!category) {
        skipped.push({ summary: event.summary, date, timeStart, reason: "not_individual" });
        continue;
      }

      const clients = resolveClientNames(extractClientNames(event.summary));
      if (clients.length === 0) {
        skipped.push({ summary: event.summary, date, timeStart, reason: "no_clients" });
        continue;
      }

      const type = lessonTypeFromNames(clients.map((c) => c.first_name));
      const externalId = stableLessonId(occ.uid, date, timeStart, event.summary);

      lessons.push({
        externalId,
        calendarUid: occ.uid,
        summary: event.summary,
        category,
        disciplineExternalId: disciplineExternalId(category),
        disciplineName: disciplineForCategory(category),
        type,
        clients: clients.map((c) => ({
          key: c.key,
          first_name: c.first_name,
          last_name: c.last_name,
          display: displayName(c),
        })),
        clientKeys: clients.map((c) => c.key),
        clientExternalIds: clients.map((c) => clientExternalId(c.key)),
        date,
        time_start: timeStart,
        time_end: timeEnd,
        price: 0,
        paid: "no",
      });
    }
  }

  const deduped = dedupeLessons(lessons);
  const { lessons: overlapResolved, removed: overlapRemoved } = resolveScheduleOverlaps(deduped);
  const manualResolutions = loadManualResolutions(manualResolutionsPath);
  const {
    lessons: manualApplied,
    excluded: manualExcluded,
    adjusted: manualAdjusted,
  } = applyManualResolutions(overlapResolved, manualResolutions);
  const overlapUnresolved = collectUnresolvedOverlaps(manualApplied);

  const usedDisciplineIds = new Set(manualApplied.map((l) => l.disciplineExternalId));
  const disciplines = Object.entries(DISCIPLINE_META)
    .filter(([, d]) => usedDisciplineIds.has(d.externalId))
    .map(([, d]) => ({
      externalId: d.externalId,
      name: d.name,
      description: "Импорт из Google Calendar",
    }));

  const clientMap = new Map();
  for (const lesson of manualApplied) {
    for (const client of lesson.clients) {
      const ext = clientExternalId(client.key);
      if (!clientMap.has(ext)) {
        clientMap.set(ext, {
          externalId: ext,
          first_name: client.first_name,
          last_name: client.last_name,
          disciplineCategories: new Set([lesson.category]),
        });
      } else {
        clientMap.get(ext).disciplineCategories.add(lesson.category);
      }
    }
  }

  const clients = [...clientMap.values()].map((c) => ({
    externalId: c.externalId,
    first_name: c.first_name,
    last_name: c.last_name,
    telegram: "",
  }));

  return {
    meta: {
      source: "google-calendar-ics",
      since: sinceDate,
      generatedAt: new Date().toISOString(),
      timezone: "Asia/Bangkok",
    },
    disciplines,
    clients,
    personal_lessons: manualApplied,
    skipped,
    overlap_removed: overlapRemoved,
    manual_excluded: manualExcluded,
    manual_adjusted: manualAdjusted,
    overlap_unresolved: overlapUnresolved,
    stats: {
      rawOccurrences: lessons.length,
      dedupedOccurrences: deduped.length,
      removedDuplicates: lessons.length - deduped.length,
      removedOverlapAuto: overlapRemoved.length,
      manualExcluded: manualExcluded.length,
      manualAdjusted: manualAdjusted.length,
      finalOccurrences: manualApplied.length,
      unresolvedOverlaps: overlapUnresolved.length,
    },
  };
}

function findInternalConflicts(lessons) {
  const conflicts = [];
  const byKey = new Map();
  for (const l of lessons) {
    const key = `${l.date}|${l.time_start}|${l.time_end}`;
    const list = byKey.get(key) ?? [];
    list.push(l);
    byKey.set(key, list);
  }
  for (const [key, list] of byKey) {
    if (list.length > 1) conflicts.push({ kind: "duplicate_slot", key, lessons: list });
  }

  for (let i = 0; i < lessons.length; i++) {
    for (let j = i + 1; j < lessons.length; j++) {
      const a = lessons[i];
      const b = lessons[j];
      if (a.date !== b.date) continue;
      if (
        timeRangesOverlap(
          toMinutes(a.time_start),
          toMinutes(a.time_end),
          toMinutes(b.time_start),
          toMinutes(b.time_end)
        )
      ) {
        conflicts.push({ kind: "time_overlap", a, b });
      }
    }
  }
  return conflicts;
}

async function findDbConflicts(orgId, lessons) {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { skipped: true, reason: "No SUPABASE credentials" };
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const dates = [...new Set(lessons.map((l) => l.date))].sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  const [{ data: existingPersonal }, { data: scheduleSlots }, { data: locations }] = await Promise.all([
    supabase
      .from("personal_lessons")
      .select("id, date, time_start, time_end, location_id, client_id1, clients:client_id1(first_name, last_name)")
      .eq("organization_id", orgId)
      .gte("date", minDate)
      .lte("date", maxDate),
    supabase
      .from("schedule_slots")
      .select("id, day_of_week, time, time_end, group_name, location_id, discipline_id")
      .eq("organization_id", orgId),
    supabase.from("locations").select("id, name").eq("organization_id", orgId),
  ]);

  const conflicts = [];
  const defaultLocationId = locations?.[0]?.id ?? null;

  for (const lesson of lessons) {
    const dow = new Date(`${lesson.date}T12:00:00Z`).getUTCDay();
    const isoDow = dow === 0 ? 7 : dow;

    for (const p of existingPersonal ?? []) {
      if (p.date !== lesson.date) continue;
      if (
        timeRangesOverlap(
          toMinutes(lesson.time_start),
          toMinutes(lesson.time_end),
          toMinutes(String(p.time_start).slice(0, 5)),
          toMinutes(String(p.time_end).slice(0, 5))
        )
      ) {
        conflicts.push({
          kind: "existing_personal_overlap",
          lesson,
          existing: p,
        });
      }
    }

    for (const slot of scheduleSlots ?? []) {
      if (slot.day_of_week !== isoDow) continue;
      if (
        timeRangesOverlap(
          toMinutes(lesson.time_start),
          toMinutes(lesson.time_end),
          toMinutes(String(slot.time).slice(0, 5)),
          toMinutes(String(slot.time_end).slice(0, 5))
        )
      ) {
        conflicts.push({
          kind: "group_slot_overlap",
          lesson,
          slot,
        });
      }
    }
  }

  return {
    skipped: false,
    defaultLocationId,
    locationNames: (locations ?? []).map((l) => l.name),
    existingPersonalCount: existingPersonal?.length ?? 0,
    scheduleSlotCount: scheduleSlots?.length ?? 0,
    conflicts,
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv);
  const icsPath = positional[0];
  if (!icsPath) {
    console.error("Usage: node scripts/ics-to-personal-lessons.mjs <calendar.ics> [--since YYYY-MM-DD] [--out path] [--check-conflicts --org-id UUID]");
    process.exit(1);
  }

  const sinceDate = flags.since ?? "2025-09-01";
  const outPath = flags.out
    ? resolve(process.cwd(), flags.out)
    : resolve(root, "data/import/albertkoall/calendar_personal_lessons.json");

  const ics = readFileSync(resolve(icsPath), "utf8");
  const events = parseIcsEvents(ics);
  const manualResolutionsPath = flags["manual-resolutions"]
    ? resolve(process.cwd(), flags["manual-resolutions"])
    : resolve(dirname(outPath), "calendar_manual_resolutions.json");
  const exportData = buildExport(events, sinceDate, manualResolutionsPath);

  const ballroom = exportData.personal_lessons.filter((l) => l.category === "ballroom_individual");
  const tango = exportData.personal_lessons.filter((l) => l.category === "tango_individual");
  const biomechanics = exportData.personal_lessons.filter((l) => l.category === "biomechanics_individual");
  const salsa = exportData.personal_lessons.filter((l) => l.summary.toLowerCase().includes("сальса"));
  const sfp = exportData.personal_lessons.filter((l) => l.category === "sfp_individual");
  const internalConflicts = findInternalConflicts(exportData.personal_lessons);

  let dbConflicts = null;
  if (flags["check-conflicts"] && flags["org-id"]) {
    dbConflicts = await findDbConflicts(flags["org-id"], exportData.personal_lessons);
  }

  writeFileSync(outPath, JSON.stringify(exportData, null, 2), "utf8");

  const conflictsPath = flags["conflicts-out"]
    ? resolve(process.cwd(), flags["conflicts-out"])
    : resolve(dirname(outPath), "calendar_conflicts.json");
  writeFileSync(
    conflictsPath,
    JSON.stringify(
      {
        count: exportData.overlap_unresolved.length,
        autoResolved: exportData.overlap_removed.length,
        conflicts: exportData.overlap_unresolved,
      },
      null,
      2
    ),
    "utf8"
  );

  const resolvedPath = resolve(dirname(outPath), "calendar_overlap_resolved.json");
  writeFileSync(resolvedPath, JSON.stringify(exportData.overlap_removed, null, 2), "utf8");

  const report = {
    icsPath: resolve(icsPath),
    outPath,
    since: sinceDate,
    totalEvents: events.length,
    personalLessons: exportData.personal_lessons.length,
    ballroomIndividual: ballroom.length,
    tangoIndividual: tango.length,
    biomechanicsIndividual: biomechanics.length,
    biomechanicsSalsaLisa: salsa.length,
    sfpIndividual: sfp.length,
    autoResolvedOverlaps: exportData.stats.removedOverlapAuto,
    manualExcluded: exportData.stats.manualExcluded,
    manualAdjusted: exportData.stats.manualAdjusted,
    unresolvedOverlaps: exportData.stats.unresolvedOverlaps,
    skipped: exportData.skipped.length,
    uniqueClients: exportData.clients.length,
    disciplines: exportData.disciplines.map((d) => d.name),
    internalConflictCount: internalConflicts.length,
    dbConflicts,
  };

  console.log(JSON.stringify(report, null, 2));

  if (exportData.overlap_unresolved.length) {
    console.log("\nUnresolved overlaps:");
    console.log(JSON.stringify(exportData.overlap_unresolved, null, 2));
  }
  if (exportData.overlap_removed.length) {
    console.log(`\nAuto-resolved overlaps: ${exportData.overlap_removed.length} (see calendar_overlap_resolved.json)`);
  }
  if (internalConflicts.length) {
    console.log("\nInternal conflicts sample:");
    console.log(JSON.stringify(internalConflicts.slice(0, 10), null, 2));
  }
  if (dbConflicts && !dbConflicts.skipped && dbConflicts.conflicts.length) {
    console.log("\nDB conflicts sample:");
    console.log(JSON.stringify(dbConflicts.conflicts.slice(0, 10), null, 2));
  }
}

main().catch((err) => {
  console.error(err.stack ?? err.message ?? err);
  process.exit(1);
});
