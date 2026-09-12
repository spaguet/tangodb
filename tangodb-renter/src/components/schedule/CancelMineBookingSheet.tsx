import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { t, type Locale } from "../../i18n/strings";
import { btnDestructiveOpenCls, btnSecondaryCls } from "../../lib/crmUi";
import { miniAppLifecycleKey } from "../../lib/lifecycle";
import { mineCancelKind, mineCancelRetainsPrepay } from "../../lib/mineCancel";
import { formatShortDate, formatTimeRange } from "../../lib/orgTime";
import { rpcCancelOccurrence, rpcDeleteHold } from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import { computeServerOffsetMs, serverNowMs } from "../../lib/serverTime";
import type { MineSlot } from "../../lib/types";

type CancelMineBookingSheetProps = {
  locale: Locale;
  timezone: string;
  serverNow: string;
  supabase: SupabaseClient;
  slot: MineSlot;
  onClose: () => void;
  onDone: () => void;
};

const sheetCls =
  "max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-4 pb-8 text-slate-800 shadow-xl [-webkit-overflow-scrolling:touch]";

export default function CancelMineBookingSheet({
  locale,
  timezone,
  serverNow,
  supabase,
  slot,
  onClose,
  onDone,
}: CancelMineBookingSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nowMs = serverNowMs(computeServerOffsetMs(serverNow));
  const kind = mineCancelKind(slot, timezone, nowMs);
  const retain = mineCancelRetainsPrepay(slot, timezone, nowMs);
  const localeTag = locale === "en" ? "en" : "ru";

  const hintKey =
    kind === "delete_hold"
      ? "cancelHoldHint"
      : kind === "cancel_occurrence"
        ? retain
          ? "cancelPaidRetainHint"
          : "cancelPaidRefundHint"
        : "cancelNotAllowedHint";

  const confirm = async () => {
    if (kind === "none") return;
    setSubmitting(true);
    setError(null);
    try {
      if (kind === "delete_hold") {
        await rpcDeleteHold(supabase, slot.id);
      } else {
        await rpcCancelOccurrence(supabase, slot.id);
      }
      onDone();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-mine-title"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div className={sheetCls} onClick={(e) => e.stopPropagation()}>
        <h2 id="cancel-mine-title" className="text-lg font-semibold text-slate-900">
          {t(locale, "cancelBooking")}
        </h2>
        <p className="text-sm text-slate-800">
          {formatShortDate(slot.date, localeTag)} · {formatTimeRange(slot.time_start, slot.time_end)}
        </p>
        <p className="text-xs font-medium text-indigo-700">
          {t(locale, miniAppLifecycleKey(slot.lifecycle))}
        </p>
        <p className="text-sm leading-relaxed text-slate-600">{t(locale, hintKey)}</p>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            className={`flex-1 ${btnSecondaryCls}`}
            disabled={submitting}
            onClick={onClose}
          >
            {t(locale, "cancel")}
          </button>
          {kind !== "none" ? (
            <button
              type="button"
              className={`flex-1 ${btnDestructiveOpenCls}`}
              disabled={submitting}
              onClick={() => void confirm()}
            >
              {t(locale, "cancelBooking")}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
