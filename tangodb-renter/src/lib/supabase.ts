import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { renterAuthStorageKey } from "./initData";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabaseEnvError =
  !supabaseUrl || !supabaseAnonKey
    ? "envMissing"
    : null;

const clientCache = new Map<string, SupabaseClient>();

/** Namespaced GoTrue storage per organization (two studios on one origin). */
export function getRenterSupabase(organizationId: string): SupabaseClient {
  const cached = clientCache.get(organizationId);
  if (cached) return cached;

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: renterAuthStorageKey(organizationId),
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  clientCache.set(organizationId, client);
  return client;
}

export function getSupabaseConfig() {
  return { url: supabaseUrl, anonKey: supabaseAnonKey };
}
