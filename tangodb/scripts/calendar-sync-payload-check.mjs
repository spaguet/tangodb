/**
 * Google Calendar event payload helpers smoke test.
 * Run: node scripts/calendar-sync-payload-check.mjs
 */
import assert from "node:assert/strict";

function expandClientLabels(clientLabels) {
  const out = [];
  const seen = new Set();
  for (const raw of clientLabels) {
    const parts = raw
      .split(/\s+&\s+|\s*,\s*|\s*;\s*|\s+и\s+/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const labels = parts.length > 0 ? parts : raw.trim() ? [raw.trim()] : [];
    for (const label of labels) {
      if (label === "Клиент" && seen.size > 0) continue;
      if (seen.has(label)) continue;
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

function joinClientLabelsForGoogle(clientLabels) {
  const labels = expandClientLabels(clientLabels);
  return labels.length > 0 ? labels.join(" и ") : "Клиент";
}

function buildPersonalLessonSummary(clientLabels, disciplineName) {
  const clients = joinClientLabelsForGoogle(clientLabels);
  const discipline = (disciplineName ?? "").trim();
  if (discipline) return `${clients} · ${discipline}`;
  return clients;
}

function buildPersonalLessonDescription(input) {
  const lines = [];
  const clients = joinClientLabelsForGoogle(input.clientLabels ?? []);
  if (clients && clients !== "Клиент") {
    lines.push(`Клиенты: ${clients}`);
  }
  const location = (input.locationName ?? "").trim();
  if (location) {
    lines.push(`Локация: ${location}`);
  }
  lines.push(
    `Организация: ${input.organizationName}`,
    `Открыть в CRM: ${input.scheduleUrl}`,
    "Управляется TangoDB. Изменяйте урок в CRM."
  );
  return lines.join("\n");
}

assert.equal(
  buildPersonalLessonSummary(["Богдан"], "Бальные танцы"),
  "Богдан · Бальные танцы"
);
assert.equal(
  buildPersonalLessonSummary(["Богдан", "Мария"], "Танго"),
  "Богдан и Мария · Танго"
);
assert.equal(buildPersonalLessonSummary([], "Танго"), "Клиент · Танго");
assert.equal(buildPersonalLessonSummary(["Богдан"], null), "Богдан");
assert.equal(
  buildPersonalLessonSummary(["Вероника & Аня Толстихина"], "Бальные танцы"),
  "Вероника и Аня Толстихина · Бальные танцы"
);
assert.equal(
  buildPersonalLessonSummary(["Соломея и Мия"], "Бальные танцы"),
  "Соломея и Мия · Бальные танцы"
);
assert.equal(
  expandClientLabels(["Вероника", "Аня Толстихина"]).join("|"),
  "Вероника|Аня Толстихина"
);
assert.equal(expandClientLabels(["R&B Solo"]).join("|"), "R&B Solo");

const description = buildPersonalLessonDescription({
  locationName: "Зал 1",
  organizationName: "Studio",
  scheduleUrl: "https://example.com/schedule",
  clientLabels: ["Вероника", "Аня Толстихина"],
});
assert.match(description, /^Клиенты: Вероника и Аня Толстихина\n/);
assert.doesNotMatch(description, /&/);
assert.match(description, /Локация: Зал 1/);

console.log("calendar-sync-payload-check: ok");
