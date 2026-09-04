/**
 * FA7 concurrent race: two parallel staff_renter_wallet_topup calls with one idempotency key.
 * Requires DATABASE_URL (or .env.local). Skips gracefully when unset.
 *
 * §9 invariant: repeat / concurrent staff topup with same key must not credit twice.
 */
import { spawn } from 'child_process';
import { resolve } from 'path';
import { loadDbTestEnv } from './load-db-test-env.mjs';

const root = loadDbTestEnv();

const ORG = 'fa700000-0000-4000-8000-000000000001';
const RENTER = 'fa700000-0000-4000-8000-000000000041';
const KEY = 'fa700000-0000-4000-8000-000000000099';

function psqlSuccess(out) {
  const trimmed = out.trim();
  return trimmed === 'true' || trimmed.includes('"success": true') || trimmed.includes('"success":true');
}

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

function parallelTopup() {
  const sql = `SELECT (_test_fa7_parallel_topup_sql('${KEY}'::uuid) ->> 'success')::text;`;
  return psql(['-t', '-A', '-c', sql]);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.log('fa2-concurrent-topup: skip (DATABASE_URL not set)');
    process.exit(0);
  }

  const jwt = resolve(root, 'supabase/tests/_hall_rent_test_jwt.sql');
  const setup = resolve(root, 'supabase/tests/renter_miniapp_fa7_concurrent_topup_test.sql');

  await psql(['-v', 'ON_ERROR_STOP=1', '-f', jwt, '-f', setup]);

  const [outA, outB] = await Promise.all([parallelTopup(), parallelTopup()]);

  for (const [label, out] of [['A', outA], ['B', outB]]) {
    if (!psqlSuccess(out)) {
      throw new Error(`parallel topup ${label}: missing success in result: ${out}`);
    }
  }

  const balanceOut = await psql([
    '-c',
    `SELECT _renter_wallet_balance('${ORG}'::uuid, '${RENTER}'::uuid);`,
  ]);
  const balanceMatch = balanceOut.match(/([0-9]+(?:\.[0-9]+)?)/);
  const balance = balanceMatch ? Number(balanceMatch[1]) : NaN;
  if (balance !== 250) {
    throw new Error(`expected wallet balance 250 after parallel same-key topup, got ${balanceOut}`);
  }

  const ledgerOut = await psql([
    '-c',
    `SELECT count(*) FROM renter_wallet_ledger
     WHERE renter_id = '${RENTER}'::uuid
       AND entry_type = 'topup'
       AND topup_request_id IS NULL;`,
  ]);
  if (!ledgerOut.includes('1')) {
    throw new Error(`expected one staff topup ledger row, got: ${ledgerOut}`);
  }

  const appliedOut = await psql([
    '-t',
    '-A',
    '-c',
    `SELECT (_test_fa7_parallel_topup_sql('${KEY}'::uuid) ->> 'already_applied')::text;`,
  ]);
  if (appliedOut.trim() !== 'true') {
    throw new Error(`expected third same-key call to return already_applied: ${appliedOut}`);
  }

  const balanceAfterRetry = await psql([
    '-c',
    `SELECT _renter_wallet_balance('${ORG}'::uuid, '${RENTER}'::uuid);`,
  ]);
  const balance2Match = balanceAfterRetry.match(/([0-9]+(?:\.[0-9]+)?)/);
  const balance2 = balance2Match ? Number(balance2Match[1]) : NaN;
  if (balance2 !== 250) {
    throw new Error(`balance changed after lost-response retry: ${balanceAfterRetry}`);
  }

  console.log('fa2-concurrent-topup: OK');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
