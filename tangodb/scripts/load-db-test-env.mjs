/**
 * Load DATABASE_URL for SQL regression scripts from .env.local / linked pooler URL.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

export function loadDbTestEnv() {
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

  if (process.env.DATABASE_URL) return root;

  const password = process.env.SUPABASE_DB_PASSWORD;
  const poolerPath = resolve(root, 'supabase/.temp/pooler-url');
  if (!password || !existsSync(poolerPath)) return root;

  const pooler = readFileSync(poolerPath, 'utf8').trim();
  try {
    const url = new URL(pooler);
    url.password = password;
    process.env.DATABASE_URL = url.toString();
  } catch {
    // leave DATABASE_URL unset
  }

  return root;
}
