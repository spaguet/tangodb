import type { SupabaseClient } from "@supabase/supabase-js";

const SIGN_TTL_SEC = 300;

export function absolutizeSignedUrl(
  url: string | null | undefined,
  supabaseOrigin: string
): string | null {
  const raw = url?.trim() ?? "";
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = supabaseOrigin.replace(/\/$/, "");
  if (!origin) return null;
  if (raw.startsWith("/")) return `${origin}${raw}`;
  return `${origin}/${raw}`;
}

export async function resolveOrgRentalQrUrl(
  supabase: SupabaseClient,
  input: { signedUrl?: string | null; storagePath?: string | null },
  supabaseOrigin: string
): Promise<string | null> {
  const path = input.storagePath?.trim();
  if (path) {
    const { data, error } = await supabase.storage.from("org-rental-qr").createSignedUrl(path, SIGN_TTL_SEC);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return absolutizeSignedUrl(input.signedUrl, supabaseOrigin);
}
