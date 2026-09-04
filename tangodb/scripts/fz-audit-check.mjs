/**
 * FZ tail verification: run Mini App SQL/script gates with DATABASE_URL from .env.local.
 */
import { spawnSync } from 'node:child_process';
import { loadDbTestEnv } from './load-db-test-env.mjs';

const root = loadDbTestEnv();

const CHECKS = [
  { name: 'stage-a', cmd: 'node', args: ['scripts/renter-miniapp-stage-a-check.mjs'] },
  { name: 'fb2', npm: 'test:db:renter-miniapp-fb2' },
  { name: 'fb3', npm: 'test:db:renter-miniapp-fb3' },
  { name: 'fb4', npm: 'test:db:renter-miniapp-fb4' },
  { name: 'fb6', npm: 'test:db:renter-miniapp-fb6' },
  { name: 'fc1', psql: 'renter_miniapp_fc1_correlation_code_test.sql' },
  { name: 'fc2', psql: 'renter_miniapp_fc2_reliability_reset_test.sql' },
  { name: 'fc3', npm: 'test:db:renter-miniapp-fc3' },
  { name: 'fc3-node', npm: 'test:renter-miniapp-fc3' },
  { name: 'fc4', npm: 'test:db:renter-miniapp-fc4' },
  { name: 'fc4-node', npm: 'test:renter-miniapp-fc4' },
  { name: 'fc5', npm: 'test:db:renter-miniapp-fc5' },
  { name: 'fc5-node', npm: 'test:renter-miniapp-fc5' },
  { name: 'fdb1', npm: 'test:db:renter-miniapp-fdb1' },
  { name: 'fdb2', npm: 'test:db:renter-miniapp-fdb2' },
  { name: 'fdb3', npm: 'test:db:renter-miniapp-fdb3' },
  { name: 'fdb4', npm: 'test:db:renter-miniapp-fdb4' },
  { name: 'fe1', npm: 'test:db:renter-miniapp-fe1' },
  { name: 'fe2', npm: 'test:db:renter-miniapp-fe2' },
  { name: 'fe3', npm: 'test:db:renter-miniapp-fe3' },
  { name: 'fe4', npm: 'test:db:renter-miniapp-fe4' },
  {
    name: 'fe5-sql',
    cmd: 'psql',
    args: () => [
      process.env.DATABASE_URL,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      'supabase/tests/_hall_rent_test_jwt.sql',
      '-f',
      'supabase/tests/renter_miniapp_fe5_auth_webhook_test.sql',
    ],
  },
];

function runCheck(check) {
  process.stdout.write(`\n=== ${check.name} ===\n`);
  let result;
  if (check.npm) {
    result = spawnSync('npm', ['run', check.npm], {
      cwd: root,
      shell: true,
      env: process.env,
      encoding: 'utf8',
    });
  } else if (check.psql) {
    result = spawnSync(
      'psql',
      [
        process.env.DATABASE_URL,
        '-v',
        'ON_ERROR_STOP=1',
        '-f',
        'supabase/tests/_hall_rent_test_jwt.sql',
        '-f',
        `supabase/tests/${check.psql}`,
      ],
      { cwd: root, encoding: 'utf8' },
    );
  } else {
    const args = typeof check.args === 'function' ? check.args() : check.args;
    result = spawnSync(check.cmd, args, { cwd: root, shell: true, env: process.env, encoding: 'utf8' });
  }
  const output = (result.stdout || '') + (result.stderr || '');
  if (output.trim()) process.stdout.write(output);
  return result.status === 0 ? null : check.name;
}

function main() {
  if (!process.env.DATABASE_URL) {
    console.error('fz-audit-check: DATABASE_URL not set');
    process.exit(1);
  }

  const failures = [];
  for (const check of CHECKS) {
    const fail = runCheck(check);
    if (fail) failures.push(fail);
  }

  console.log('\n--- FZ summary ---');
  if (failures.length) {
    console.error(`FAILED (${failures.length}): ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('All FZ checks passed');
}

main();
