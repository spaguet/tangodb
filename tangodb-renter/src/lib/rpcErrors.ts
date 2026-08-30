import type { MessageKey } from "../i18n/strings";

const ERROR_MAP: Record<string, MessageKey> = {
  "renter.addonInactive": "addonInactive",
  "renter.booking.conflict": "bookingConflict",
  "renter.booking.duplicate": "bookingConflict",
  "renter.booking.fieldsInvalid": "bookingInvalid",
  "renter.booking.holdLimit": "holdLimit",
  "renter.booking.unfinishedLimit": "unfinishedLimit",
  "renter.booking.locationUnavailable": "locationUnavailable",
  "renter.booking.noRate": "noRate",
  "renter.booking.outsideWindow": "outsideWindow",
  "renter.booking.packInsufficientBalance": "packInsufficientBalance",
  "renter.booking.packWindow": "packInvalid",
  "renter.booking.timeInvalid": "timeInvalid",
  "renter.booking.tooSoon": "tooSoon",
  "renter.booking.debtBlocked": "debtBlocked",
  "renter.booking.banned": "bookingBanned",
  "renter.topup.pendingExists": "topupPendingExists",
  "renter.topup.amountInvalid": "topupAmountInvalid",
  "renter.topup.amountTooLarge": "topupAmountTooLarge",
  "renter.topup.methodInvalid": "topupMethodInvalid",
  "renter.topup.qrInvalid": "topupQrInvalid",
  "renter.rateLimited": "rateLimited",
  "renter.profile.displayNameInvalid": "profileNameInvalid",
  "renter.forbidden": "actionForbidden",
};

export function rpcErrorKey(err: unknown): MessageKey {
  const raw = err instanceof Error ? err.message : String(err);
  if (ERROR_MAP[raw]) return ERROR_MAP[raw];
  if (raw.startsWith("renter.booking.")) return "bookingConflict";
  if (raw.startsWith("renter.topup.")) return "topupFailed";
  return "rpcFailed";
}
