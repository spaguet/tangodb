import { t } from "./i18n";
import type { I18nKey } from "./i18n/keys";
import type { TranslateFn } from "./utils";

/** Dotted i18n keys; segments may be camelCase (`hooks.error.personalOverlap`). */
const I18N_KEY_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9_]*)+$/;

/** snake_case RPC / Postgres error codes — not shown to users as-is. */
const SNAKE_CASE_RE = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

const RPC_ERROR_KEY_MAP: Record<string, I18nKey> = {
  idempotency_conflict: "common.error.idempotencyConflict",
  forbidden: "common.error.forbidden",
  unauthorized: "common.error.unauthorized",
  state_conflict: "offline.error.stateConflict",
  invalid_attendees: "venueCosts.closeLesson.errorInvalidAttendees",
  close_lesson_failed: "venueCosts.closeLesson.errorFailed",
  invalid_occurrence: "venueCosts.closeLesson.errorOccurrenceInvalid",
  group_occurrence_not_found: "venueCosts.closeLesson.errorOccurrenceNotFound",
  personal_lesson_not_found: "hooks.error.lessonNotFound",
  closure_attendee_count_conflict: "venueCosts.closeLesson.errorAttendeeConflict",
  closure_not_found: "venueCosts.closeLesson.errorClosureNotFound",
  venue_rule_ack_required: "venueCosts.paymentConfirm.title",
  conflict: "schedule.rental.conflict",
  request_failed: "common.saveFailed",
  request_save_failed: "common.saveFailed",
};

export function isI18nKey(value: string): value is I18nKey {
  return I18N_KEY_RE.test(value);
}

function isTechnicalUserMessage(error: string): boolean {
  if (isI18nKey(error)) return false;
  if (RPC_ERROR_KEY_MAP[error]) return false;
  if (SNAKE_CASE_RE.test(error)) return true;

  const lower = error.toLowerCase();
  return (
    lower.includes("violates") ||
    lower.includes("foreign key") ||
    lower.includes("pgrst") ||
    lower.includes("jwt") ||
    lower.includes("stored-procedure") ||
    lower.includes("check constraint") ||
    lower.includes("duplicate key") ||
    lower.includes("row-level security") ||
    lower.includes("audit_log_operation_check") ||
    lower === "empty response" ||
    lower === "sync failed"
  );
}

/** Translate hook mutation errors: I18nKey strings are translated; technical codes map to human text. */
export function resolveMutationError(
  error: string | undefined,
  fallback: I18nKey,
  translate: TranslateFn
): string {
  if (!error) return translate(fallback);
  if (isI18nKey(error)) return translate(error);
  if (RPC_ERROR_KEY_MAP[error]) return translate(RPC_ERROR_KEY_MAP[error]);
  if (
    error.includes("single_visits") &&
    (error.includes("foreign key") || error.includes("violates foreign key"))
  ) {
    return translate("schedule.error.cancelHasLinkedVisits");
  }
  if (
    error.includes("stored-procedure-failed") ||
    error.includes("audit_log_operation_check") ||
    error.includes("violates check constraint")
  ) {
    return translate("corrections.error.storedProcedureFailed");
  }
  if (isTechnicalUserMessage(error)) return translate(fallback);
  return error;
}

export function resolveMutationErrorWithLocale(
  error: string | undefined,
  fallback: I18nKey,
  locale?: string | null
): string {
  if (!error) return t(locale, fallback);
  if (isI18nKey(error)) return t(locale, error);
  if (RPC_ERROR_KEY_MAP[error]) return t(locale, RPC_ERROR_KEY_MAP[error]);
  if (isTechnicalUserMessage(error)) return t(locale, fallback);
  return error;
}
