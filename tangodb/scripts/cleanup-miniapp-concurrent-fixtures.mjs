/**
 * Purge committed Mini App concurrent-test orgs / users / helper RPCs.
 * Safe to run against hosted DB (does not refuse production).
 *
 *   node scripts/cleanup-miniapp-concurrent-fixtures.mjs
 */
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDbTestEnv } from './load-db-test-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const root = resolve(dirname(__filename), '..');
const cleanupSql = resolve(root, 'supabase/tests/_cleanup_miniapp_concurrent_fixtures.sql');

export function cleanupMiniappConcurrentFixtures() {
  const url = process.env.DATABASE_URL;
  if (!url) return Promise.resolve();
  return new Promise((resolvePromise, reject) => {
    const child = spawn('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', cleanupSql], {
      stdio: 'pipe',
      shell: false,
    });
    let out = '';
    let err = '';
    child.stdout?.on('data', (d) => {
      out += d;
    });
    child.stderr?.on('data', (d) => {
      err += d;
    });
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

const isMain = process.argv[1] && resolve(process.argv[1]) === __filename;
if (isMain) {
  loadDbTestEnv({ refuseHosted: false });
  if (!process.env.DATABASE_URL) {
    console.error('cleanup-miniapp-concurrent-fixtures: DATABASE_URL not set');
    process.exit(1);
  }
  cleanupMiniappConcurrentFixtures()
    .then(() => {
      console.log('cleanup-miniapp-concurrent-fixtures: OK');
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
