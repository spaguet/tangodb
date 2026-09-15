import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { t, tFill, type Locale } from "../../i18n/strings";
import { btnDestructiveOpenCls, btnSecondaryCls } from "../../lib/crmUi";
import { miniAppLifecycleKey } from "../../lib/lifecycle";
import { mineCancelKind, mineCancelRetainsPrepay } from "../../lib/mineCancel";
import { formatShortDate, formatTimeRange } from "../../lib/orgTime";
import { cancelMineSlot } from "../../lib/cancelMineSlot";
import { rpcErrorKey } from "../../lib/rpcErrors";
import { computeServerOffsetMs, serverNowMs } from "../../lib/serverTime";
import type { MineSlot } from "../../lib/types";

type CancelMineBookingSheetProps = {
  locale: Locale;
  timezone: string;
  serverNow: string;
  supabase: SupabaseClient;
  slot: MineSlot;
  allMine?: MineSlot[];
  onClose: () => void;
  onDone: () => void;
};

const sheetCls =
  "max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-xl border border-slate-200 bg-white p-4 pb-8 text-slate-800 shadow-xl [-webkit-overflow-scrolling:touch]";

function isPackSlotCancellable(m: MineSlot): boolean {
  return m.can_delete_hold === true || m.can_cancel_occurrence === true;
}

export default function CancelMineBookingSheet({
  locale,
  timezone,
  serverNow,
  supabase,
  slot,
  allMine = [],
  onClose,
  onDone,
}: CancelMineBookingSheetProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmPackFromDate, setConfirmPackFromDate] = useState(false);
  const nowMs = serverNowMs(computeServerOffsetMs(serverNow));
  const kind = mineCancelKind(slot, timezone, nowMs);
  const retain = mineCancelRetainsPrepay(slot, timezone, nowMs);
  const localeTag = locale === "en" ? "en" : "ru";

  const seriesId = slot.rental_series_id ?? null;
  const packFromDateSlots = useMemo(() => {
    if (!seriesId) return [];
    return allMine.filter(
      (m) =>
        m.rental_series_id === seriesId && m.date >= slot.date && isPackSlotCancellable(m)
    );
  }, [allMine, seriesId, slot.date]);

  const showPackFromDate = Boolean(seriesId) && packFromDateSlots.length > 1;
  const packBatchTotal = packFromDateSlots.length;

  const hintKey =
    kind === "delete_hold"
      ? "cancelHoldHint"
      : kind === "cancel_occurrence"
        ? retain
          ? "cancelPaidRetainHint"
          : "cancelPaidRefundHint"
        : "cancelNotAllowedHint";

  const confirm = async () => {
    if (kind === "none" && slot.can_delete_hold !== true && slot.can_cancel_occurrence !== true) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await cancelMineSlot(supabase, slot, timezone, nowMs);
      onDone();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPackBatch = async () => {
    if (packFromDateSlots.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const ordered = [...packFromDateSlots].sort(
        (a, b) => a.date.localeCompare(b.date) || a.time_start.localeCompare(b.time_start)
      );
      for (const s of ordered) {
        await cancelMineSlot(supabase, s, timezone, nowMs);
      }
      onDone();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setSubmitting(false);
      setConfirmPackFromDate(false);
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
        {showPackFromDate ? (
          <p className="text-xs leading-relaxed text-slate-500">{t(locale, "cancelPackFromDateHint")}</p>
        ) : null}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {confirmPackFromDate ? (
          <p className="text-sm font-medium text-rose-800">
            {tFill(locale, "cancelPackFromDateConfirm", {
              date: formatShortDate(slot.date, localeTag),
              count: String(packBatchTotal),
            })}
          </p>
        ) : null}
        <div className="flex flex-col gap-2 pt-1">
          <div className="flex gap-2">
            <button
              type="button"
              className={`flex-1 ${btnSecondaryCls}`}
              disabled={submitting}
              onClick={onClose}
            >
              {t(locale, "cancel")}
            </button>
            {kind !== "none" || slot.can_delete_hold === true || slot.can_cancel_occurrence === true ? (
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
          {showPackFromDate ? (
            <button
              type="button"
              className={btnDestructiveOpenCls}
              disabled={submitting}
              onClick={() => {
                if (confirmPackFromDate) {
                  void confirmPackBatch();
                } else {
                  setConfirmPackFromDate(true);
                }
              }}
            >
              {confirmPackFromDate
                ? tFill(locale, "cancelPackFromDateConfirm", {
                    date: formatShortDate(slot.date, localeTag),
                    count: String(packBatchTotal),
                  })
                : tFill(locale, "cancelPackFromDate", {
                    date: formatShortDate(slot.date, localeTag),
                  })}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
