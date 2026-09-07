/**
 * Fail fast before any SQL test touches a hosted/production DATABASE_URL.
 */
import { loadDbTestEnv } from './load-db-test-env.mjs';

loadDbTestEnv();
if (!process.env.DATABASE_URL) {
  console.error(
    'DATABASE_URL is not set. Point it at local `supabase start` (postgresql://postgres:postgres@127.0.0.1:54322/postgres).',
  );
  process.exit(1);
}
