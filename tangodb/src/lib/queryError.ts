import { isI18nKey, resolveMutationError } from "./resolveMutationError";
import type { TranslateFn } from "./utils";

/** Normalize React Query / Supabase errors for UI (PostgrestError is a plain object, not Error). */
export function toQueryError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }
  if (typeof error === "string" && error.trim()) return new Error(error);
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error("Unknown error");
  }
}

export function queryErrorRawMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error.trim();
  if (typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message.trim();
  }
  return "";
}

/** Primary line: translate dotted i18n keys instead of showing `renters.error.notFound`. */
export function queryErrorTitle(
  error: unknown,
  translate: TranslateFn,
  override?: string
): string {
  if (override) return override;
  const raw = queryErrorRawMessage(error);
  if (raw && isI18nKey(raw)) return translate(raw);
  return translate("common.error.loadFailed");
}

/** Secondary line; omitted when it would repeat the title or a translated i18n key. */
export function queryErrorDetail(
  error: unknown,
  translate: TranslateFn,
  title: string
): string | null {
  const raw = queryErrorRawMessage(error);
  if (!raw) return null;
  const text = resolveMutationError(raw, "common.error.loadFailed", translate);
  if (!text || text === title) return null;
  return text;
}

export function queryErrorFromState(query: {
  error: unknown | null;
  isError: boolean;
}): Error | null {
  if (!query.isError || query.error == null) return null;
  return toQueryError(query.error);
}
