/**
 * Dry-run validation of tangodb_export.json before Supabase import
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { formatDate } from './migrate.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const exportPath = resolve(__dirname, '..', 'tangodb_export.json');

if (!existsSync(exportPath)) {
  console.error('tangodb_export.json not found');
  process.exit(1);
}

const data = JSON.parse(readFileSync(exportPath, 'utf8'));
const issues = [];

const clientIds = new Set((data.clients ?? []).map((c) => String(c.ID)));
const subIds = new Set((data.subscriptions ?? []).map((s) => String(s.ID)));

for (const c of data.clients ?? []) {
  if (typeof c.ID === 'number') {
    issues.push({
      severity: 'warning',
      type: 'client_numeric_id',
      id: c.ID,
      stringId: String(c.ID),
      note: 'Sheets exported ID as number — possible precision loss in JSON',
    });
  }
}

for (const l of data.personalLessons ?? []) {
  if (typeof l.ID === 'number') {
    issues.push({
      severity: 'warning',
      type: 'personal_numeric_id',
      id: l.ID,
      stringId: String(l.ID),
    });
  }
}

const refClients = new Set();
for (const s of data.subscriptions ?? []) {
  if (s.ClientID1) refClients.add(String(s.ClientID1));
  if (s.ClientID2) refClients.add(String(s.ClientID2));
}
for (const l of data.personalLessons ?? []) {
  for (const k of ['Client1', 'Client2', 'Client3']) {
    if (l[k]) refClients.add(String(l[k]));
  }
}

const missingClients = [...refClients].filter((id) => !clientIds.has(id));
if (missingClients.length) {
  issues.push({
    severity: 'info',
    type: 'missing_clients_in_sheet',
    count: missingClients.length,
    ids: missingClients,
    note: 'migrate.mjs creates stub clients "Удалён (ID …)"',
  });
}

const badAttSub = (data.attendance ?? []).filter((a) => !subIds.has(String(a.SubscriptionID)));
if (badAttSub.length) {
  issues.push({
    severity: 'error',
    type: 'attendance_unknown_subscription',
    count: badAttSub.length,
    ids: [...new Set(badAttSub.map((a) => String(a.SubscriptionID)))],
  });
}

const validTypes = new Set(['solo', 'pair', 'pair_hm']);
const validStatus = new Set(['active', 'finished']);
const validLessons = new Set([4, 8]);
const validAtt = new Set(['present', 'absent', 'freeze']);

for (const s of data.subscriptions ?? []) {
  if (!validTypes.has(s.Type)) {
    issues.push({ severity: 'error', type: 'sub_bad_type', id: s.ID, value: s.Type });
  }
  if (!validStatus.has(s.Status)) {
    issues.push({ severity: 'error', type: 'sub_bad_status', id: s.ID, value: s.Status });
  }
  if (!validLessons.has(parseInt(s.LessonsTotal, 10))) {
    issues.push({ severity: 'error', type: 'sub_bad_lessons_total', id: s.ID, value: s.LessonsTotal });
  }
  if (s.Type === 'pair' && !s.ClientID2) {
    issues.push({ severity: 'error', type: 'pair_no_client2', id: s.ID });
  }
  const fu = parseInt(s.FreezeUsed, 10);
  if (fu > 1 || fu < 0) {
    issues.push({ severity: 'error', type: 'sub_bad_freeze', id: s.ID, value: s.FreezeUsed });
  }
}

for (const a of data.attendance ?? []) {
  if (!validAtt.has(a.AttendanceStatus)) {
    issues.push({
      severity: 'error',
      type: 'att_bad_status',
      date: a.Date,
      subId: a.SubscriptionID,
      value: a.AttendanceStatus,
    });
  }
}

const validPLTypes = new Set(['solo', 'pair', 'trio']);
for (const l of data.personalLessons ?? []) {
  if (!validPLTypes.has(l.Type)) {
    issues.push({ severity: 'error', type: 'pl_bad_type', id: l.ID, value: l.Type });
  }
  if (!['yes', 'no'].includes(l.Paid)) {
    issues.push({ severity: 'error', type: 'pl_bad_paid', id: l.ID, value: l.Paid });
  }
}

const attKeys = new Map();
for (const a of data.attendance ?? []) {
  const k = `${formatDate(a.Date)}|${String(a.SubscriptionID)}`;
  if (attKeys.has(k)) {
    issues.push({ severity: 'error', type: 'dup_attendance', key: k });
  }
  attKeys.set(k, true);
}

for (const s of data.schedule ?? []) {
  const dow = parseInt(s.DayOfWeek, 10);
  if (dow < 1 || dow > 7) {
    issues.push({ severity: 'error', type: 'bad_day_of_week', value: s });
  }
}

// Name typos in attendance ClientDisplay (Мочулский vs Мочульский)
const nameVariants = new Map();
for (const a of data.attendance ?? []) {
  const base = a.ClientDisplay.replace(/Мочульский/g, 'Мочулский');
  if (base !== a.ClientDisplay) {
    nameVariants.set(a.ClientDisplay, base);
  }
}
if (nameVariants.size) {
  issues.push({
    severity: 'warning',
    type: 'attendance_name_typo',
    note: 'Inconsistent spelling Мочулский/Мочульский in ClientDisplay (cosmetic, stored as-is)',
    examples: Object.fromEntries(nameVariants),
  });
}

// First personal lesson price anomaly
const plPriceOutliers = (data.personalLessons ?? []).filter(
  (l) => parseFloat(l.Price) !== 800000
);
if (plPriceOutliers.length) {
  issues.push({
    severity: 'warning',
    type: 'personal_price_outlier',
    note: 'Most personal_solo lessons are 800000; these differ',
    rows: plPriceOutliers.map((l) => ({ id: l.ID, price: l.Price, date: l.Date })),
  });
}

const seedPrices = {
  'solo|4': 1200000,
  'solo|8': 2100000,
  'pair_m1|8': 3400000,
  'pair_m2|8': 3100000,
  'pair_m3|8': 2800000,
  'pair_hm|4': 1800000,
  'personal_solo|1': 900000,
  'personal_pair|1': 1300000,
  'personal_trio|1': 1600000,
};
const priceDiffs = [];
for (const p of data.prices ?? []) {
  const key = `${p.Type}|${p.Lessons}`;
  const seed = seedPrices[key];
  if (seed != null && seed !== p.Price) {
    priceDiffs.push({ type: p.Type, lessons: p.Lessons, sheets: p.Price, seed });
  }
}
if (priceDiffs.length) {
  issues.push({
    severity: 'info',
    type: 'prices_differ_from_schema_seed',
    note: 'Sheets prices will overwrite seed defaults on migrate (expected)',
    diffs: priceDiffs,
  });
}

const errors = issues.filter((i) => i.severity === 'error');
console.log(
  JSON.stringify(
    {
      ok: errors.length === 0,
      counts: {
        clients: (data.clients ?? []).length,
        schedule: (data.schedule ?? []).length,
        prices: (data.prices ?? []).length,
        subscriptions: (data.subscriptions ?? []).length,
        attendance: (data.attendance ?? []).length,
        personalLessons: (data.personalLessons ?? []).length,
        stubClientsNeeded: missingClients.length,
      },
      missingClients,
      issues,
    },
    null,
    2
  )
);

process.exit(errors.length ? 1 : 0);
