/**
 * FA3 concurrent race: create waits on wallet lock while debt is accrued.
 * Requires DATABASE_URL (or .env). Skips gracefully when unset.
 */
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadDbTestEnv } from './load-db-test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = loadDbTestEnv();

function psql(args, { inherit = false } = {}) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return new Promise((resolvePromise, reject) => {
    const child = spawn('psql', [url, ...args], {
      stdio: inherit ? 'inherit' : 'pipe',
      shell: false,
    });
    let out = '';
    let err = '';
    if (!inherit) {
      child.stdout?.on('data', (d) => { out += d; });
      child.stderr?.on('data', (d) => { err += d; });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err || out || `psql exit ${code}`));
      } else {
        resolvePromise(out);
      }
    });
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('fa3-concurrent-race: skip (DATABASE_URL not set)');
    process.exit(0);
  }

  const jwt = resolve(root, 'supabase/tests/_hall_rent_test_jwt.sql');
  const race = resolve(root, 'supabase/tests/renter_miniapp_fa3_concurrent_race_test.sql');

  await psql(['-v', 'ON_ERROR_STOP=1', '-f', jwt, '-f', race]);

  await psql([
    '-c',
    `UPDATE rentals
     SET debt_amount = 75, lifecycle = 'debt'
     WHERE id = 'a0f30000-0000-4000-8000-000000000062'::uuid;`,
  ]);

  const holdSql = `
    SELECT _test_fa3_hold_wallet_mutate(
      'a0f30000-0000-4000-8000-000000000001'::uuid,
      'a0f30000-0000-4000-8000-000000000041'::uuid,
      'a0f30000-0000-4000-8000-000000000062'::uuid,
      0,
      4
    );
  `;

  const createSql = `
    SELECT _hall_rent_test_set_jwt(
      'a0f30000-0000-4000-8000-000000000011'::uuid,
      'a0f30000-0000-4000-8000-000000000001'::uuid,
      'a0f30000-0000-4000-8000-000000000021'::uuid,
      'owner'
    );
    SELECT renter_create_booking(jsonb_build_object(
      'renter_id', 'a0f30000-0000-4000-8000-000000000041',
      'location_id', 'a0f30000-0000-4000-8000-0000000000aa',
      'rental_date', (SELECT rental_date + 2 FROM rentals WHERE id = 'a0f30000-0000-4000-8000-000000000061'),
      'time_start', '14:00',
      'time_end', '15:00',
      'idempotency_key', 'fa3-concurrent-debt'
    )) AS result;
  `;

  const holdProc = spawn('psql', [process.env.DATABASE_URL, '-c', holdSql], { shell: false });
  await new Promise((r) => setTimeout(r, 400));

  const out = await psql(['-c', createSql]);
  if (!out.includes('renter.booking.debt')) {
    throw new Error(`expected renter.booking.debt in create result, got: ${out}`);
  }

  const slotCheck = await psql([
    '-c',
    `SELECT count(*) FROM rentals WHERE idempotency_key = 'fa3-concurrent-debt';`,
  ]);
  if (!slotCheck.includes('0')) {
    throw new Error(`slot inserted during debt race: ${slotCheck}`);
  }

  holdProc.on('close', () => {});
  console.log('fa3-concurrent-race: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
