import { asJson } from "./json";
import { reportClientError } from "./reportClientError";
import { supabase } from "./supabase";

export type RenterDocumentFinalizeResult =
  | { success: true; documentId: string }
  | { success: false; error: string };

const FINALIZE_ATTEMPTS = 2;
const REMOVE_ATTEMPTS = 2;

export async function removeRenterStorageObject(bucket: string, path: string): Promise<boolean> {
  let lastMessage = "storage remove failed";
  for (let attempt = 0; attempt < REMOVE_ATTEMPTS; attempt += 1) {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (!error) return true;
    lastMessage = error.message;
  }
  reportClientError(new Error(lastMessage), {
    area: "mutation",
    action: "removeRenterDocumentObject",
    meta: { bucket, path },
  });
  return false;
}

async function finalizeRenterDocumentUpload(
  payload: Record<string, unknown>
): Promise<RenterDocumentFinalizeResult> {
  const { data, error } = await supabase.rpc("finalize_renter_document_upload", {
    p_payload: asJson(payload),
  });
  if (error) {
    return { success: false, error: error.message };
  }
  const fin = data as { success?: boolean; error?: string; document_id?: string } | null;
  if (!fin?.success) {
    return { success: false, error: fin?.error ?? "renters.error.documentFinalizeFailed" };
  }
  return { success: true, documentId: fin.document_id ?? "" };
}

/** `undefined` = lookup failed (inconclusive); `null` = no row. */
async function findRenterDocumentIdByPath(storagePath: string): Promise<string | null | undefined> {
  const { data, error } = await supabase
    .from("renter_documents")
    .select("id")
    .eq("storage_path", storagePath)
    .maybeSingle();
  if (error) {
    reportClientError(error, {
      area: "mutation",
      action: "findRenterDocumentByPath",
      meta: { storagePath },
    });
    return undefined;
  }
  const id = data && typeof data === "object" && "id" in data ? data.id : null;
  return id != null ? String(id) : null;
}

/**
 * Bind an already-uploaded Storage object to a CRM row.
 * Retries finalize; if still failing, looks up an existing row (commit without response)
 * before removing the object. Does not delete Storage when the lookup is inconclusive,
 * to avoid a CRM document pointing at a missing file.
 */
export async function bindUploadedRenterDocument(input: {
  bucket: string;
  storagePath: string;
  finalizePayload: Record<string, unknown>;
}): Promise<RenterDocumentFinalizeResult> {
  let lastFail: RenterDocumentFinalizeResult = {
    success: false,
    error: "renters.error.documentFinalizeFailed",
  };

  for (let attempt = 0; attempt < FINALIZE_ATTEMPTS; attempt += 1) {
    const result = await finalizeRenterDocumentUpload(input.finalizePayload);
    if (result.success) return result;
    lastFail = result;
  }

  const existingId = await findRenterDocumentIdByPath(input.storagePath);
  if (typeof existingId === "string" && existingId.length > 0) {
    return { success: true, documentId: existingId };
  }

  if (existingId === null) {
    await removeRenterStorageObject(input.bucket, input.storagePath);
  }

  return lastFail;
}
