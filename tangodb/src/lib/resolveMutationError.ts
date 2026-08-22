import { t } from "./i18n";
import type { I18nKey } from "./i18n/keys";
import type { TranslateFn } from "./utils";

const I18N_KEY_RE = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)+$/;

export function isI18nKey(value: string): value is I18nKey {
  return I18N_KEY_RE.test(value);
}

/** Translate hook mutation errors: I18nKey strings are translated; raw Supabase messages pass through. */
export function resolveMutationError(
  error: string | undefined,
  fallback: I18nKey,
  translate: TranslateFn
): string {
  if (!error) return translate(fallback);
  if (isI18nKey(error)) return translate(error);
  if (
    error.includes("audit_log_operation_check") ||
    error.includes("violates check constraint")
  ) {
    return translate("corrections.error.storedProcedureFailed");
  }
  return error;
}

export function resolveMutationErrorWithLocale(
  error: string | undefined,
  fallback: I18nKey,
  locale?: string | null
): string {
  if (!error) return t(locale, fallback);
  if (isI18nKey(error)) return t(locale, error);
  return error;
}
