/**
 * Upload studio Mini App QR, delete it, or mint a fresh signed URL.
 * Upload/delete require can_manage_settings; sign also allows renter JWT via renter_list_active_qr.
 */

import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 2048;

type UploadBody = {
  action?: string;
  id?: string;
  label?: string;
  is_active?: boolean;
  filename?: string;
  content_base64?: string;
};

function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function looksLikeSvgOrHtml(bytes: Uint8Array): boolean {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 256)).trimStart().toLowerCase();
  return head.startsWith("<svg") || head.startsWith("<?xml") || head.startsWith("<!doctype html") || head.startsWith("<html");
}

function readU32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  return { width: readU32BE(bytes, 16), height: readU32BE(bytes, 20) };
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height };
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + len;
  }
  return null;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
  if (chunk === "VP8X") {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  return null;
}

function decodeBase64(input: string): Uint8Array | null {
  try {
    const binary = atob(input.replace(/\s/g, ""));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  if (!(await checkRateLimit(`renter-qr-upload:ip:${getClientIp(req)}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  let body: UploadBody;
  try {
    body = (await req.json()) as UploadBody;
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const { data: canManage } = await userClient.rpc("can_manage_settings");

  if (body.action === "sign") {
    const assetId = body.id ?? "";
    if (!assetId) {
      return jsonResponse({ error: "renter.qr.payloadInvalid" }, 400, req);
    }

    const admin = createServiceClient();
    let storagePath = "";

    if (canManage === true) {
      const { data: orgId } = await userClient.rpc("auth_organization_id");
      if (!orgId) {
        return jsonResponse({ error: "Unauthorized" }, 401, req);
      }
      const { data: asset, error: assetError } = await admin
        .from("organization_rental_qr_assets")
        .select("storage_path")
        .eq("organization_id", orgId)
        .eq("id", assetId)
        .maybeSingle();
      if (assetError || !asset?.storage_path) {
        return jsonResponse({ error: "renter.qr.notFound" }, 404, req);
      }
      storagePath = String(asset.storage_path);
    } else {
      const { data: listed, error: listError } = await userClient.rpc("renter_list_active_qr");
      const result = listed as
        | { success?: boolean; error?: string; assets?: Array<Record<string, unknown>> }
        | null;
      if (listError || !result?.success) {
        return jsonResponse({ error: result?.error ?? "Forbidden" }, 403, req);
      }
      const asset = (result.assets ?? []).find((row) => String(row.id ?? "") === assetId);
      if (!asset?.storage_path) {
        return jsonResponse({ error: "renter.qr.notFound" }, 404, req);
      }
      storagePath = String(asset.storage_path);
    }

    const { data: signed, error: signError } = await admin
      .storage
      .from("org-rental-qr")
      .createSignedUrl(storagePath, 3600);
    if (signError || !signed?.signedUrl) {
      return jsonResponse({ error: "renter.qr.saveFailed" }, 400, req);
    }
    return jsonResponse(
      { success: true, id: assetId, signed_url: signed.signedUrl, expires_in: 3600 },
      200,
      req
    );
  }

  if (canManage !== true) {
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  if (body.action === "delete") {
    const assetId = body.id ?? "";
    if (!assetId) {
      return jsonResponse({ error: "renter.qr.payloadInvalid" }, 400, req);
    }
    const { data: deleted, error: deleteError } = await userClient.rpc("delete_organization_rental_qr_asset", {
      p_id: assetId,
    });
    const result = deleted as { success?: boolean; error?: string; storage_path?: string } | null;
    if (deleteError || !result?.success) {
      return jsonResponse({ error: result?.error ?? "renter.qr.deleteFailed" }, 400, req);
    }
    if (result.storage_path) {
      const admin = createServiceClient();
      await admin.storage.from("org-rental-qr").remove([result.storage_path]);
    }
    return jsonResponse({ success: true, id: assetId }, 200, req);
  }

  const raw = decodeBase64(body.content_base64 ?? "");
  if (!raw || raw.length === 0) {
    return jsonResponse({ error: "renter.qr.payloadInvalid" }, 400, req);
  }
  if (raw.length > MAX_BYTES) {
    return jsonResponse({ error: "renter.qr.tooLarge" }, 400, req);
  }
  if (looksLikeSvgOrHtml(raw)) {
    return jsonResponse({ error: "renter.qr.mimeInvalid" }, 400, req);
  }
  const mime = sniffMime(raw);
  if (!mime) {
    return jsonResponse({ error: "renter.qr.mimeInvalid" }, 400, req);
  }

  let dims: { width: number; height: number } | null = null;
  if (mime === "image/png") dims = pngSize(raw);
  else if (mime === "image/jpeg") dims = jpegSize(raw);
  else dims = webpSize(raw);

  if (!dims || dims.width < 1 || dims.height < 1 || dims.width > MAX_SIDE || dims.height > MAX_SIDE) {
    return jsonResponse({ error: "renter.qr.dimensionsInvalid" }, 400, req);
  }

  const assetId = crypto.randomUUID();
  const storagePath = `${orgId}/${assetId}`;
  const admin = createServiceClient();
  const { error: uploadError } = await admin.storage.from("org-rental-qr").upload(storagePath, raw, {
    contentType: mime,
    upsert: false,
  });
  if (uploadError) {
    return jsonResponse({ error: "renter.qr.uploadFailed" }, 400, req);
  }

  const { data: memberId } = await userClient.rpc("auth_member_id");
  const { data: created, error: createError } = await admin.rpc("create_organization_rental_qr_asset", {
    p_payload: {
      id: assetId,
      organization_id: orgId,
      storage_path: storagePath,
      mime_type: mime,
      file_size: raw.length,
      width: dims.width,
      height: dims.height,
      label: body.label ?? "",
      is_active: body.is_active === true,
      created_by: memberId ?? null,
    },
  });

  const result = created as { success?: boolean; error?: string; id?: string } | null;
  if (createError || !result?.success) {
    await admin.storage.from("org-rental-qr").remove([storagePath]);
    return jsonResponse({ error: result?.error ?? "renter.qr.saveFailed" }, 400, req);
  }

  return jsonResponse({ success: true, id: result.id, storage_path: storagePath }, 200, req);
});
