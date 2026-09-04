import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./supabase";
import type { QrAsset } from "./types";

const SIGN_TTL_SEC = 300;

export function absolutizeSignedUrl(url: string | null | undefined): string | null {
  const raw = url?.trim() ?? "";
  if (!raw) return null;
  if (/^(data|blob):/i.test(raw)) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  const origin = getSupabaseConfig().url.replace(/\/$/, "");
  if (!origin) return null;
  if (raw.startsWith("/")) return `${origin}${raw}`;
  return `${origin}/${raw}`;
}

export function qrInlineDataUrl(input: {
  content_base64?: string | null;
  mime_type?: string | null;
}): string | null {
  const b64 = input.content_base64?.trim();
  if (!b64) return null;
  const mime = (input.mime_type?.trim() || "image/png").split(";")[0];
  if (!mime.startsWith("image/")) return null;
  return `data:${mime};base64,${b64}`;
}

export function qrDisplaySrc(input: {
  signed_url?: string | null;
  content_base64?: string | null;
  mime_type?: string | null;
}): string | null {
  return qrHttpsDownloadUrl(input) ?? qrInlineDataUrl(input);
}

export function qrHttpsDownloadUrl(input: { signed_url?: string | null }): string | null {
  const signed = absolutizeSignedUrl(input.signed_url);
  return signed && /^https:\/\//i.test(signed) ? signed : null;
}

export async function resolveOrgRentalQrUrl(
  supabase: SupabaseClient,
  asset: Pick<QrAsset, "storage_path">
): Promise<string | null> {
  const path = asset.storage_path?.trim();
  if (!path) return null;
  const { data, error } = await supabase.storage.from("org-rental-qr").createSignedUrl(path, SIGN_TTL_SEC);
  if (!error && data?.signedUrl) return data.signedUrl;
  return null;
}

export function qrDownloadFilename(label: string | null | undefined, id: string): string {
  const safe = (label ?? "").trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-|-$/g, "");
  return `${safe || "studio-qr"}-${id.slice(0, 8)}.png`;
}
