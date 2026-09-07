/**
 * Run psql against a local DATABASE_URL only.
 * Usage: node scripts/psql-local-test.mjs -f supabase/tests/foo.sql [-f more.sql]
 */
import { spawn } from 'node:child_process';
import { loadDbTestEnv } from './load-db-test-env.mjs';

loadDbTestEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    'DATABASE_URL is not set. Point it at local `supabase start` (postgresql://postgres:postgres@127.0.0.1:54322/postgres).',
  );
  process.exit(1);
}

const extra = process.argv.slice(2);
if (!extra.length) {
  console.error('psql-local-test: pass psql args, e.g. -f supabase/tests/foo.sql');
  process.exit(1);
}

const child = spawn('psql', [url, '-v', 'ON_ERROR_STOP=1', ...extra], {
  stdio: 'inherit',
  shell: false,
});
child.on('error', (err) => {
  console.error(err);
  process.exit(1);
});
child.on('close', (code) => {
  process.exit(code ?? 1);
});
