import { createClient } from "@supabase/supabase-js";
import type { Database } from "../types/database";

const configuredUrl = import.meta.env.VITE_SUPABASE_URL ?? "";
const configuredKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
/** Node assert-scripts import this module without Vite env; keep browser fail-fast if misconfigured. */
const isBrowser = typeof window !== "undefined";
const supabaseUrl = configuredUrl || (!isBrowser ? "http://127.0.0.1:54321" : "");
const supabaseAnonKey = configuredKey || (!isBrowser ? "public-anon-key" : "");

const REMEMBER_ME_PREF_KEY = "tangodb:remember-me";

let usePersistentStorage = readRememberMePreference();

function readRememberMePreference(): boolean {
  try {
    const stored = localStorage.getItem(REMEMBER_ME_PREF_KEY);
    return stored === null ? true : stored === "true";
  } catch {
    return true;
  }
}

export function getRememberMePreference(): boolean {
  return usePersistentStorage;
}

export function setAuthRememberMe(remember: boolean): void {
  usePersistentStorage = remember;
  try {
    localStorage.setItem(REMEMBER_ME_PREF_KEY, String(remember));
  } catch {
    // ignore quota / private mode
  }
}

const authStorage = {
  getItem(key: string): string | null {
    if (usePersistentStorage) {
      return localStorage.getItem(key);
    }
    return sessionStorage.getItem(key) ?? localStorage.getItem(key);
  },
  setItem(key: string, value: string): void {
    if (usePersistentStorage) {
      sessionStorage.removeItem(key);
      localStorage.setItem(key, value);
      return;
    }
    localStorage.removeItem(key);
    sessionStorage.setItem(key, value);
  },
  removeItem(key: string): void {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    persistSession: true,
  },
});
