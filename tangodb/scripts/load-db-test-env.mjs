/**
 * Load DATABASE_URL for SQL regression scripts from .env.local / .env.
 * Never auto-fills the linked production pooler URL.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

export function isHostedSupabaseUrl(url = process.env.DATABASE_URL ?? '') {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.includes('supabase.co') || host.includes('supabase.com');
  } catch {
    return /supabase\.(co|com)/i.test(url);
  }
}

export function assertNotHostedSupabase(url = process.env.DATABASE_URL ?? '') {
  if (process.env.ALLOW_PROD_DB_TESTS === '1') return;
  if (!isHostedSupabaseUrl(url)) return;
  throw new Error(
    'Refusing SQL tests against hosted Supabase. Use local `supabase start` and a local DATABASE_URL (postgresql://postgres:postgres@127.0.0.1:54322/postgres). To override: ALLOW_PROD_DB_TESTS=1, then npm run test:db:cleanup-miniapp-fixtures.',
  );
}

export function loadDbTestEnv({ refuseHosted = true } = {}) {
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

  if (refuseHosted) assertNotHostedSupabase();
  return root;
}
