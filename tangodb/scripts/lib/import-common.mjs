import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const tangodbRoot = resolve(__dirname, '../..');

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

export function loadEnv() {
  for (const name of ['.env.migrate', '.env.local', '.env']) {
    const path = resolve(tangodbRoot, name);
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

export function fileSha256(path) {
  const buf = readFileSync(path);
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

export function detectFormat(data) {
  if (data.version === 2 || data.settings != null) return 'v2-json';
  const first = data.clients?.[0];
  if (first && ('FirstName' in first || 'ID' in first)) return 'legacy-gas';
  if (first && ('first_name' in first || 'externalId' in first)) return 'v2-json';
  return 'legacy-gas';
}

export function parseArgs(argv) {
  const args = {
    dryRun: false,
    apply: false,
    orgId: null,
    input: null,
    slug: null,
    resumeFrom: null,
    format: null,
    defaultDiscipline: null,
    defaultLocationName: null,
    defaultLocationId: null,
    skipDbConflicts: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--apply') args.apply = true;
    else if (a === '--org-id') args.orgId = argv[++i];
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--slug') args.slug = argv[++i];
    else if (a === '--resume-from') args.resumeFrom = argv[++i];
    else if (a === '--format') args.format = argv[++i];
    else if (a === '--default-discipline') args.defaultDiscipline = argv[++i];
    else if (a === '--default-location-name') args.defaultLocationName = argv[++i];
    else if (a === '--default-location-id') args.defaultLocationId = argv[++i];
    else if (a === '--skip-db-conflicts') args.skipDbConflicts = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }

  return args;
}

export function printUsage() {
  console.log(`Usage: node scripts/import-org.mjs (--dry-run | --apply) --org-id UUID --input PATH [options]

Options:
  --slug NAME              Mapping file slug (default: org-id prefix)
  --resume-from STEP       Skip steps before STEP (clients, prices, subscriptions, ...)
  --format legacy-gas|v2-json   Force format (auto-detect by default)
  --default-discipline NAME     Create default discipline for legacy schedule (optional)
  --default-location-name NAME  Attach imported rows to existing location (postprocess)
  --default-location-id UUID    Attach imported rows to existing location by id

Env: SUPABASE_URL, SUPABASE_SERVICE_KEY`);
}

export function createSupabaseClient() {
  loadEnv();
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_KEY');
  }
  return createClient(supabaseUrl, serviceKey);
}

export async function upsertBatch(supabase, table, rows, options = {}) {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).upsert(chunk, options);
    if (error) throw new Error(`${table} batch ${i}: ${error.message}`);
  }
}

export async function insertBatch(supabase, table, rows) {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw new Error(`${table} batch ${i}: ${error.message}`);
  }
}

export const IMPORT_STEPS = [
  'settings',
  'locations',
  'disciplines',
  'classes',
  'clients',
  'prices',
  'schedule_slots',
  'subscriptions',
  'attendance',
  'personal_lessons',
];

export function shouldRunStep(step, resumeFrom) {
  if (!resumeFrom) return true;
  const startIdx = IMPORT_STEPS.indexOf(resumeFrom);
  const stepIdx = IMPORT_STEPS.indexOf(step);
  if (startIdx === -1) throw new Error(`Unknown --resume-from step: ${resumeFrom}`);
  return stepIdx >= startIdx;
}

const GROUP_PRICE_TYPES = new Set(['solo', 'pair_m1', 'pair_m2', 'pair_m3', 'pair_hm']);
const PRIVATE_PRICE_TYPES = new Set(['personal_solo', 'personal_pair', 'personal_trio']);

export function inferPriceCategory(type) {
  const t = String(type).trim();
  if (GROUP_PRICE_TYPES.has(t)) return 'group';
  if (PRIVATE_PRICE_TYPES.has(t)) return 'private';
  return null;
}
