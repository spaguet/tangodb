/**
 * Stage A (FA1–FA7) SQL regression gate for renter Mini App money invariants (audit §9).
 *
 * Usage: node scripts/renter-miniapp-stage-a-check.mjs
 * Requires DATABASE_URL in .env.local / .env.migrate / .env (skips DB steps when unset).
 */
import { spawnSync } from 'node:child_process';
import { loadDbTestEnv } from './load-db-test-env.mjs';

const root = loadDbTestEnv();

const STAGE_A_SCRIPTS = [
  'test:db:renter-miniapp-p0',
  'test:db:renter-miniapp-p0-fa2',
  'test:db:renter-miniapp-fa3',
  'test:db:renter-miniapp-fa4',
  'test:db:renter-miniapp-fa5',
  'test:db:renter-miniapp-fa6',
  'test:db:renter-miniapp-fa7',
];

function main() {
  if (!process.env.DATABASE_URL) {
    console.log('renter-miniapp-stage-a-check: skip (DATABASE_URL not set)');
    process.exit(0);
  }

  const failures = [];

  for (const script of STAGE_A_SCRIPTS) {
    process.stdout.write(`\n=== npm run ${script} ===\n`);
    const result = spawnSync('npm', ['run', script], {
      encoding: 'utf8',
      cwd: root,
      shell: true,
      env: process.env,
    });
    const output = (result.stdout || '') + (result.stderr || '');
    if (output.trim()) process.stdout.write(output);
    if (result.status !== 0) failures.push(`npm run ${script}`);
  }

  if (failures.length) {
    console.error(
      `\nrenter-miniapp-stage-a-check FAILED (${failures.length}):\n${failures.map((f) => `  - ${f}`).join('\n')}`,
    );
    process.exit(1);
  }

  console.log('\nrenter-miniapp-stage-a-check: all stage A invariants passed');
}

main();
