/**
 * FDB4 concurrent races for variant B pack series.
 * Requires DATABASE_URL (or .env.local). Skips gracefully when unset.
 *
 * §9 variant B: pack held, activated and expired as one series under concurrency.
 */
import { spawn } from 'child_process';
import { resolve } from 'path';
import { loadDbTestEnv } from './load-db-test-env.mjs';

const root = loadDbTestEnv();

const ORG_CONCURRENT = 'fdb40000-0000-4000-8000-000000000001';
const ORG_EXPIRE = 'fdb40000-0000-4000-8000-000000000002';
const ORG_CANCEL = 'fdb40000-0000-4000-8000-000000000003';
const RENTER_EXPIRE = 'fdb40000-0000-4000-8000-000000000051';

function psql(args) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  return new Promise((resolvePromise, reject) => {
    const child = spawn('psql', [url, ...args], {
      stdio: 'pipe',
      shell: false,
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { err += d; });
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

function psqlJson(sql) {
  return psql(['-t', '-A', '-c', sql]);
}

function parseJson(out) {
  const trimmed = out.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function countMatch(out, expected) {
  return out.includes(String(expected));
}

async function assertSeriesConsistency(orgId, seriesId, label) {
  const out = await psql([
    '-c',
    `SELECT
       (SELECT status FROM rental_series WHERE id = '${seriesId}'::uuid) AS series_status,
       (SELECT count(*) FROM rentals WHERE rental_series_id = '${seriesId}'::uuid AND lifecycle = 'awaiting_payment') AS awaiting_n,
       (SELECT count(*) FROM rentals WHERE rental_series_id = '${seriesId}'::uuid AND lifecycle IN ('active', 'prepaid_charged')) AS active_n,
       (SELECT count(*) FROM rentals WHERE rental_series_id = '${seriesId}'::uuid AND lifecycle = 'hold_deleted') AS hold_deleted_n,
       (SELECT count(*) FROM rentals WHERE rental_series_id = '${seriesId}'::uuid AND lifecycle = 'auto_deleted') AS auto_deleted_n,
       (SELECT count(*) FROM rentals WHERE rental_series_id = '${seriesId}'::uuid) AS total_n;`,
  ]);

  const awaiting = Number((out.match(/awaiting_n\s*\|\s*(\d+)/) || [])[1] ?? NaN);
  const active = Number((out.match(/active_n\s*\|\s*(\d+)/) || [])[1] ?? NaN);
  const holdDeleted = Number((out.match(/hold_deleted_n\s*\|\s*(\d+)/) || [])[1] ?? NaN);
  const autoDeleted = Number((out.match(/auto_deleted_n\s*\|\s*(\d+)/) || [])[1] ?? NaN);
  const total = Number((out.match(/total_n\s*\|\s*(\d+)/) || [])[1] ?? NaN);
  const status = (out.match(/series_status\s*\|\s*(\w+)/) || [])[1];

  if (total !== 12) {
    throw new Error(`${label}: expected 12 rentals, got ${total}\n${out}`);
  }

  const terminal =
    (awaiting === 12 && status === 'awaiting_payment') ||
    (active === 12 && status === 'active') ||
    (holdDeleted === 12 && status === 'cancelled') ||
    (autoDeleted === 12 && status === 'cancelled');

  if (!terminal) {
    throw new Error(`${label}: mixed/non-terminal series state\n${out}`);
  }

  if (awaiting > 0 && awaiting < 12) {
    throw new Error(`${label}: partial awaiting activation forbidden (${awaiting}/12)\n${out}`);
  }
  if (active > 0 && active < 12) {
    throw new Error(`${label}: partial active forbidden (${active}/12)\n${out}`);
  }
  if (holdDeleted > 0 && holdDeleted < 12) {
    throw new Error(`${label}: partial hold_deleted forbidden (${holdDeleted}/12)\n${out}`);
  }
  if (autoDeleted > 0 && autoDeleted < 12) {
    throw new Error(`${label}: partial auto_deleted forbidden (${autoDeleted}/12)\n${out}`);
  }

  return { status, awaiting, active, holdDeleted, autoDeleted };
}

async function testConcurrentOverlappingCreate() {
  await psql([
    '-c',
    `DELETE FROM rentals WHERE organization_id = '${ORG_CONCURRENT}'::uuid;
     DELETE FROM rental_series WHERE organization_id = '${ORG_CONCURRENT}'::uuid;`,
  ]);

  const [outA, outB] = await Promise.all([
    psqlJson(`SELECT _test_fdb4_parallel_pack_create('41', 'fdb4-race-overlap-a');`),
    psqlJson(`SELECT _test_fdb4_parallel_pack_create('42', 'fdb4-race-overlap-b');`),
  ]);

  const results = [outA, outB].map((raw) => parseJson(raw));
  const successes = results.filter((r) => r?.success);
  const conflicts = results.filter((r) => r?.error === 'renter.booking.conflict');

  if (successes.length !== 1) {
    throw new Error(`concurrent overlap: expected exactly one success, got ${JSON.stringify(results)}`);
  }
  if (conflicts.length !== 1) {
    throw new Error(`concurrent overlap: expected one conflict, got ${JSON.stringify(results)}`);
  }

  const countOut = await psql([
    '-c',
    `SELECT count(*) FROM rental_series WHERE organization_id = '${ORG_CONCURRENT}'::uuid;`,
  ]);
  if (!countMatch(countOut, 1)) {
    throw new Error(`concurrent overlap: expected one series persisted, got ${countOut}`);
  }

  const slotsOut = await psql([
    '-c',
    `SELECT count(*) FROM rentals WHERE organization_id = '${ORG_CONCURRENT}'::uuid;`,
  ]);
  if (!countMatch(slotsOut, 12)) {
    throw new Error(`concurrent overlap: expected 12 slots, got ${slotsOut}`);
  }
}

async function testExpireVsTopupRace() {
  const prepayOut = await psql([
    '-t',
    '-A',
    '-c',
    `SELECT COALESCE(sum(r.prepay_amount), 0)
     FROM rentals r
     JOIN rental_series rs ON rs.id = r.rental_series_id
     WHERE rs.organization_id = '${ORG_EXPIRE}'::uuid
       AND rs.idempotency_key = 'fdb4-expire-race';`,
  ]);
  const prepay = Number(prepayOut.trim());
  if (!Number.isFinite(prepay) || prepay <= 0) {
    throw new Error(`expire race: invalid prepay ${prepayOut}`);
  }

  const topupKey = 'fdb40000-0000-4000-8000-0000000000e1';
  const expireProc = spawn(
    'psql',
    [process.env.DATABASE_URL, '-c', 'SELECT _test_fdb4_expire_race_hold(2.5);'],
    { shell: false },
  );

  await new Promise((r) => setTimeout(r, 300));

  const topupOut = await psqlJson(
    `SELECT _test_fdb4_topup_race(${prepay}, '${topupKey}'::uuid);`,
  );
  const topup = parseJson(topupOut);
  if (!topup?.success) {
    throw new Error(`expire race topup failed: ${topupOut}`);
  }

  await new Promise((resolvePromise, reject) => {
    expireProc.on('error', reject);
    expireProc.on('close', (code) => {
      if (code !== 0) reject(new Error(`expire race hold proc exit ${code}`));
      else resolvePromise();
    });
  });

  const seriesOut = await psql([
    '-t',
    '-A',
    '-c',
    `SELECT id::text FROM rental_series
     WHERE organization_id = '${ORG_EXPIRE}'::uuid
       AND idempotency_key = 'fdb4-expire-race';`,
  ]);
  const seriesId = seriesOut.trim();
  await assertSeriesConsistency(ORG_EXPIRE, seriesId, 'expire-vs-topup');
}

async function testCancelVsTopupRace() {
  const seriesOut = await psql([
    '-t',
    '-A',
    '-c',
    `SELECT id::text FROM rental_series
     WHERE organization_id = '${ORG_CANCEL}'::uuid
       AND idempotency_key = 'fdb4-cancel-race';`,
  ]);
  const seriesId = seriesOut.trim();
  if (!seriesId) {
    throw new Error('cancel race: series fixture missing');
  }

  const prepayOut = await psql([
    '-t',
    '-A',
    '-c',
    `SELECT COALESCE(sum(r.prepay_amount), 0)
     FROM rentals r
     WHERE r.rental_series_id = '${seriesId}'::uuid;`,
  ]);
  const prepay = Number(prepayOut.trim());
  if (!Number.isFinite(prepay) || prepay <= 0) {
    throw new Error(`cancel race: invalid prepay ${prepayOut}`);
  }

  const topupKey = 'fdb40000-0000-4000-8000-0000000000c1';
  const [cancelOut, topupOut] = await Promise.all([
    psqlJson('SELECT _test_fdb4_cancel_race();'),
    psqlJson(`SELECT _test_fdb4_topup_race_cancel(${prepay}, '${topupKey}'::uuid);`),
  ]);

  const cancel = parseJson(cancelOut);
  const topup = parseJson(topupOut);
  if (!cancel?.success && !topup?.success) {
    throw new Error(`cancel-vs-topup: both failed\n${cancelOut}\n${topupOut}`);
  }

  await assertSeriesConsistency(ORG_CANCEL, seriesId, 'cancel-vs-topup');
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('fdb4-concurrent-pack: skip (DATABASE_URL not set)');
    process.exit(0);
  }

  const jwt = resolve(root, 'supabase/tests/_hall_rent_test_jwt.sql');
  const setup = resolve(root, 'supabase/tests/renter_miniapp_fdb4_series_concurrent_test.sql');

  await psql(['-v', 'ON_ERROR_STOP=1', '-f', jwt, '-f', setup]);

  await testConcurrentOverlappingCreate();
  await testExpireVsTopupRace();
  await testCancelVsTopupRace();

  console.log('fdb4-concurrent-pack: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
