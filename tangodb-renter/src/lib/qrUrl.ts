import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./supabase";
import type { QrAsset } from "./types";

const SIGN_TTL_SEC = 3600;

export function absolutizeSignedUrl(url: string | null | undefined): string | null {
  const raw = url?.trim() ?? "";
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = getSupabaseConfig().url.replace(/\/$/, "");
  if (!origin) return null;
  if (raw.startsWith("/")) return `${origin}${raw}`;
  return `${origin}/${raw}`;
}

export async function resolveOrgRentalQrUrl(
  supabase: SupabaseClient,
  asset: Pick<QrAsset, "signed_url" | "storage_path">
): Promise<string | null> {
  const path = asset.storage_path?.trim();
  if (path) {
    const { data, error } = await supabase.storage.from("org-rental-qr").createSignedUrl(path, SIGN_TTL_SEC);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return absolutizeSignedUrl(asset.signed_url);
}

export function qrDownloadFilename(label: string | null | undefined, id: string): string {
  const safe = (label ?? "").trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-|-$/g, "");
  return `${safe || "studio-qr"}-${id.slice(0, 8)}.png`;
}
