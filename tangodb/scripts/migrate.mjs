/**
 * One-time import: tangodb_export.json → Supabase
 * Run exportAllData() in GAS first, download tangodb_export.json to tangodb/
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_KEY (service role)
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function loadEnv() {
  for (const name of ['.env.migrate', '.env.local', '.env']) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/** Sheets Date / ISO / YYYY-MM-DD → 'YYYY-MM-DD' */
export function formatDate(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0, 10);
  const d = val instanceof Date ? val : new Date(val);
  if (isNaN(d.getTime())) return String(val);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function findExportFile() {
  const candidates = [
    resolve(root, 'tangodb_export.json'),
    resolve(root, '..', 'tangodb_export.json'),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function upsertBatch(supabase, table, rows, options) {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(chunk, options);
    if (error) throw new Error(`${table} batch ${i}: ${error.message}`);
  }
}

async function main() {
  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error(
      'Missing env: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_KEY (service role, not anon)'
    );
    process.exit(1);
  }

  const exportPath = findExportFile();
  if (!exportPath) {
    console.error(
      'tangodb_export.json not found. Run exportAllData() in GAS, download the file to tangodb/'
    );
    process.exit(1);
  }

  console.log(`Reading ${exportPath}`);
  const data = JSON.parse(readFileSync(exportPath, 'utf8'));
  const supabase = createClient(supabaseUrl, serviceKey);

  const clientById = new Map();
  for (const c of data.clients ?? []) {
    const id = String(c.ID);
    clientById.set(id, {
      id,
      first_name: c.FirstName || '—',
      last_name: c.LastName || '—',
      telegram: c.Telegram || '',
    });
  }

  // Subscriptions/personal may reference clients removed from the Clients sheet
  const ensureClient = (id) => {
    if (!id) return;
    const key = String(id);
    if (!clientById.has(key)) {
      clientById.set(key, {
        id: key,
        first_name: 'Удалён',
        last_name: `(ID ${key.slice(-6)})`,
        telegram: '',
      });
    }
  };

  for (const s of data.subscriptions ?? []) {
    ensureClient(s.ClientID1);
    ensureClient(s.ClientID2);
  }
  for (const l of data.personalLessons ?? []) {
    ensureClient(l.Client1);
    ensureClient(l.Client2);
    ensureClient(l.Client3);
  }

  const clients = [...clientById.values()];
  console.log(`clients: ${clients.length}`);
  if (clients.length) await upsertBatch(supabase, 'clients', clients, { onConflict: 'id' });

  const schedule = (data.schedule ?? []).map((s) => ({
    day_of_week: parseInt(s.DayOfWeek, 10),
    time: s.Time,
  }));
  console.log(`schedule: ${schedule.length}`);
  if (schedule.length) {
    await upsertBatch(supabase, 'schedule', schedule, { onConflict: 'day_of_week,time' });
  }

  const prices = (data.prices ?? [])
    .filter((p) => p.Type)
    .map((p) => ({
      type: String(p.Type).trim(),
      lessons: parseInt(p.Lessons, 10),
      price: parseFloat(p.Price) || 0,
    }));
  console.log(`prices: ${prices.length}`);
  if (prices.length) {
    await upsertBatch(supabase, 'prices', prices, { onConflict: 'type,lessons' });
  }

  const subs = (data.subscriptions ?? []).map((s) => ({
    id: String(s.ID),
    type: s.Type,
    client_id1: String(s.ClientID1),
    client_id2: s.ClientID2 ? String(s.ClientID2) : null,
    lessons_total: parseInt(s.LessonsTotal, 10),
    lessons_left: parseInt(s.LessonsLeft, 10),
    freeze_used: parseInt(s.FreezeUsed, 10) || 0,
    activation_date: formatDate(s.ActivationDate),
    status: s.Status,
    pair_month: s.PairMonth != null && s.PairMonth !== '' ? String(s.PairMonth) : '',
  }));
  console.log(`subscriptions: ${subs.length}`);
  if (subs.length) await upsertBatch(supabase, 'subscriptions', subs, { onConflict: 'id' });

  const att = (data.attendance ?? []).map((a) => ({
    date: formatDate(a.Date),
    subscription_id: String(a.SubscriptionID),
    client_display: a.ClientDisplay,
    attendance_status: a.AttendanceStatus,
  }));
  console.log(`attendance: ${att.length}`);
  if (att.length) {
    await upsertBatch(supabase, 'attendance', att, { onConflict: 'date,subscription_id' });
  }

  const personal = (data.personalLessons ?? []).map((l) => ({
    id: String(l.ID),
    type: l.Type,
    client_id1: l.Client1 ? String(l.Client1) : null,
    client_id2: l.Client2 ? String(l.Client2) : null,
    client_id3: l.Client3 ? String(l.Client3) : null,
    date: formatDate(l.Date),
    price: parseFloat(l.Price) || 0,
    paid: l.Paid || 'no',
  }));
  console.log(`personal_lessons: ${personal.length}`);
  if (personal.length) {
    await upsertBatch(supabase, 'personal_lessons', personal, { onConflict: 'id' });
  }

  console.log('Migration complete.');
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
