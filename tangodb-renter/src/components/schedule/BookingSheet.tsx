import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { btnPrimaryCls, btnSecondaryCls, fieldCls, labelCls, panelCls } from "../../lib/crmUi";
import { formatMoney } from "../../lib/format";
import { slotEndOptions, slotStartOptions, snapTime } from "../../lib/grid";
import {
  bookingScope,
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
} from "../../lib/idempotency";
import { rpcCreateBooking, rpcQuoteOneTime } from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import type { QuoteOneTime } from "../../lib/types";
import { formatTimeRange } from "../../lib/orgTime";
import { t, type Locale } from "../../i18n/strings";

type BookingSheetProps = {
  locale: Locale;
  organizationId: string;
  supabase: SupabaseClient;
  locationId: string;
  date: string;
  defaultStart: string;
  onClose: () => void;
  onSuccess: () => void;
};

export default function BookingSheet({
  locale,
  organizationId,
  supabase,
  locationId,
  date,
  defaultStart,
  onClose,
  onSuccess,
}: BookingSheetProps) {
  const [timeStart, setTimeStart] = useState(snapTime(defaultStart));
  const [timeEnd, setTimeEnd] = useState("");
  const [quote, setQuote] = useState<QuoteOneTime | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const starts = useMemo(() => slotStartOptions(), []);
  const endOptions = useMemo(() => slotEndOptions(timeStart), [timeStart]);

  useEffect(() => {
    if (!timeEnd && endOptions.length > 0) {
      setTimeEnd(endOptions[0]);
    }
  }, [endOptions, timeEnd]);

  useEffect(() => {
    if (!timeEnd) return;
    let cancelled = false;
    (async () => {
      setQuoting(true);
      setError(null);
      try {
        const q = await rpcQuoteOneTime(supabase, {
          location_id: locationId,
          rental_date: date,
          time_start: timeStart,
          time_end: timeEnd,
        });
        if (!cancelled) setQuote(q);
      } catch (err) {
        if (!cancelled) setError(t(locale, rpcErrorKey(err)));
      } finally {
        if (!cancelled) setQuoting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, locationId, date, timeStart, timeEnd, locale]);

  const submit = async () => {
    if (!timeEnd || quote?.busy) return;
    setSubmitting(true);
    setError(null);
    const scope = bookingScope(organizationId, locationId, date, timeStart, timeEnd);
    const idem = getOrCreateIdempotencyKey(scope);
    try {
      await rpcCreateBooking(supabase, {
        location_id: locationId,
        rental_date: date,
        time_start: timeStart,
        time_end: timeEnd,
        idempotency_key: idem,
      });
      clearIdempotencyKey(scope);
      setMessage(t(locale, "bookingSuccess"));
      onSuccess();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={onClose}>
      <div
        className="w-full max-w-md space-y-3 rounded-t-2xl border border-slate-200 bg-white p-4 pb-8 text-slate-800 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-slate-900">{t(locale, "bookSlot")}</h2>
        <p className="text-sm text-slate-500">
          {date} · {formatTimeRange(timeStart, timeEnd || "…")}
        </p>

        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t(locale, "startTime")}</span>
          <select
            className={fieldCls}
            value={timeStart}
            onChange={(e) => {
              setTimeStart(e.target.value);
              setTimeEnd("");
            }}
          >
            {starts.map((t0) => (
              <option key={t0} value={t0}>
                {t0}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelCls}>{t(locale, "endTime")}</span>
          <select className={fieldCls} value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)}>
            {endOptions.map((te) => (
              <option key={te} value={te}>
                {te}
              </option>
            ))}
          </select>
        </label>

        {quoting ? (
          <p className="text-sm text-slate-500">{t(locale, "quoteLoading")}</p>
        ) : quote ? (
          <div className={`${panelCls} space-y-1 p-3 text-sm`}>
            <p className="text-slate-800">
              {t(locale, "cost")}: {formatMoney(quote.cost, quote.currency, locale)}
            </p>
            <p className="text-slate-600">
              {t(locale, "prepay")}: {formatMoney(quote.prepay, quote.currency, locale)}
            </p>
            {quote.busy ? <p className="text-rose-600">{t(locale, "bookingConflict")}</p> : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        {message ? <p className="text-sm font-medium text-indigo-600">{message}</p> : null}

        <div className="flex gap-2 pt-2">
          <button type="button" className={`flex-1 ${btnSecondaryCls}`} onClick={onClose}>
            {t(locale, "cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || quoting || !quote || quote.busy}
            className={`flex-1 ${btnPrimaryCls}`}
            onClick={() => void submit()}
          >
            {t(locale, "confirmBook")}
          </button>
        </div>
      </div>
    </div>
  );
}
