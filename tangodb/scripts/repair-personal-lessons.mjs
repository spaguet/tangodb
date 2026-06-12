/**
 * Backfill client_id1/2/3 on personal_lessons imported from GAS.
 * The first migrate run read Client1 while the export uses ClientID1.
 *
 * Usage: node scripts/repair-personal-lessons.mjs [path/to/tangodb_export.json]
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { formatDate } from './migrate.mjs';

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

const asId = (value) => {
  if (value == null || value === '') return null;
  return String(value).trim() || null;
};

const clientRef = (row, n) => asId(row[`ClientID${n}`] ?? row[`Client${n}`]);

function findExportFile(argPath) {
  if (argPath) return resolve(argPath);
  const candidates = [resolve(root, 'tangodb_export.json'), resolve(root, '..', 'tangodb_export.json')];
  return candidates.find((p) => existsSync(p)) ?? null;
}

async function main() {
  loadEnv();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.local');
    process.exit(1);
  }

  const exportPath = findExportFile(process.argv[2]);
  if (!exportPath) {
    console.error('tangodb_export.json not found');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync(exportPath, 'utf8'));
  const lessons = data.personalLessons ?? [];
  if (!lessons.length) {
    console.log('No personal lessons in export');
    return;
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  let updated = 0;
  let skipped = 0;
  let missing = 0;

  for (const row of lessons) {
    const id = asId(row.ID);
    if (!id) continue;

    const client_id1 = clientRef(row, 1);
    const client_id2 = clientRef(row, 2);
    const client_id3 = clientRef(row, 3);

    if (!client_id1) {
      missing++;
      continue;
    }

    const { data: existing, error: fetchError } = await supabase
      .from('personal_lessons')
      .select('id, client_id1, client_id2, client_id3')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw new Error(`fetch ${id}: ${fetchError.message}`);
    if (!existing) {
      skipped++;
      continue;
    }

    if (existing.client_id1 === client_id1 && existing.client_id2 === client_id2 && existing.client_id3 === client_id3) {
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from('personal_lessons')
      .update({
        client_id1,
        client_id2,
        client_id3,
        type: row.Type,
        date: formatDate(row.Date),
        price: parseFloat(row.Price) || 0,
        paid: row.Paid || 'no',
      })
      .eq('id', id);

    if (updateError) throw new Error(`update ${id}: ${updateError.message}`);
    updated++;
  }

  const { count: nullCount } = await supabase
    .from('personal_lessons')
    .select('*', { count: 'exact', head: true })
    .is('client_id1', null);

  console.log(
    JSON.stringify(
      {
        exportLessons: lessons.length,
        updated,
        skipped,
        exportMissingClient1: missing,
        dbNullClient1After: nullCount ?? 0,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
