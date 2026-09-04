import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { btnPrimaryCls, btnSecondaryCls, fieldCls, labelCls } from "../../lib/crmUi";
import { formatHoldDeadline, formatMoney } from "../../lib/format";
import { useHoldCountdown } from "../../hooks/useServerClock";
import { slotEndOptions, slotStartOptions, snapTime } from "../../lib/grid";
import {
  bookingScope,
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
} from "../../lib/idempotency";
import { formatTimeRange } from "../../lib/orgTime";
import { rpcCreateBooking, rpcGetWallet, rpcQuoteOneTime } from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import type { QuoteOneTime, RentalItem, WalletData } from "../../lib/types";
import { t, tFill, type Locale } from "../../i18n/strings";
import QuoteSummary, { topupAmountFromWallet } from "./QuoteSummary";

type BookingSheetProps = {
  locale: Locale;
  timezone: string;
  serverNow: string;
  organizationId: string;
  supabase: SupabaseClient;
  locationId: string;
  date: string;
  defaultStart: string;
  onClose: () => void;
  onDone: () => void;
  onTopup: (amount: number) => void;
};

const ACTIVE_LIFECYCLES = new Set(["active", "prepaid_charged", "settled"]);

export default function BookingSheet({
  locale,
  timezone,
  serverNow,
  organizationId,
  supabase,
  locationId,
  date,
  defaultStart,
  onClose,
  onDone,
  onTopup,
}: BookingSheetProps) {
  const [timeStart, setTimeStart] = useState(snapTime(defaultStart));
  const [timeEnd, setTimeEnd] = useState("");
  const [quote, setQuote] = useState<QuoteOneTime | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RentalItem | null>(null);

  const countdown = useHoldCountdown(
    created?.hold_expires_at ?? null,
    created?.lifecycle === "awaiting_payment",
    serverNow,
    onDone
  );

  const starts = useMemo(() => slotStartOptions(), []);
  const endOptions = useMemo(() => slotEndOptions(timeStart), [timeStart]);
  const localeTag = locale === "en" ? "en" : "ru";

  useEffect(() => {
    if (!timeEnd && endOptions.length > 0) {
      setTimeEnd(endOptions[0]);
    }
  }, [endOptions, timeEnd]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setWalletLoading(true);
      try {
        const w = await rpcGetWallet(supabase, 1, 0);
        if (!cancelled) setWallet(w);
      } catch {
        if (!cancelled) setWallet(null);
      } finally {
        if (!cancelled) setWalletLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

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
    if (!timeEnd || quote?.busy || quote?.can_create === false) return;
    setSubmitting(true);
    setError(null);
    const scope = bookingScope(organizationId, locationId, date, timeStart, timeEnd);
    const idem = getOrCreateIdempotencyKey(scope);
    try {
      const result = await rpcCreateBooking(supabase, {
        location_id: locationId,
        rental_date: date,
        time_start: timeStart,
        time_end: timeEnd,
        idempotency_key: idem,
      });
      clearIdempotencyKey(scope);
      setCreated(result.rental);
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  const handleTopup = (amount: number) => {
    onTopup(amount);
    onDone();
  };

  if (created) {
    const currency = created.currency ?? quote?.currency ?? "RUB";
    const prepay = created.prepay_amount ?? quote?.prepay ?? 0;
    const isHold = created.lifecycle === "awaiting_payment";
    const isActive = ACTIVE_LIFECYCLES.has(created.lifecycle);
    const deadline = formatHoldDeadline(created.hold_expires_at, localeTag, timezone);
    const topupAmount =
      wallet && isHold ? topupAmountFromWallet(wallet, prepay) : prepay > 0 ? prepay : 0;

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={onClose}>
        <div
          className="w-full max-w-md space-y-3 rounded-t-2xl border border-slate-200 bg-white p-4 pb-8 text-slate-800 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-lg font-semibold text-slate-900">{t(locale, "bookingResultTitle")}</h2>
          <p className="text-sm text-slate-500">
            {date} · {formatTimeRange(created.time_start, created.time_end)}
          </p>

          {isHold ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">
                {deadline
                  ? tFill(locale, "bookingNeedPrepayBy", {
                      amount: formatMoney(topupAmount, currency, locale),
                      time: deadline,
                    })
                  : tFill(locale, "bookingNeedPrepay", {
                      amount: formatMoney(topupAmount, currency, locale),
                    })}
              </p>
              {countdown ? (
                <p className="text-xs text-amber-800">
                  {t(locale, "holdExpires")}: {countdown}
                </p>
              ) : null}
              {wallet && wallet.debt_amount > 0 ? (
                <p className="text-xs leading-relaxed">
                  {tFill(locale, "topupDebtThenActivate", {
                    debt: formatMoney(wallet.debt_amount, currency, locale),
                    prepay: formatMoney(prepay, currency, locale),
                  })}
                </p>
              ) : null}
            </div>
          ) : isActive ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
              {t(locale, "bookingActive")}
            </p>
          ) : (
            <p className="text-sm text-slate-600">{created.lifecycle}</p>
          )}

          <div className="flex flex-col gap-2 pt-2">
            {isHold && topupAmount > 0 ? (
              <button
                type="button"
                className={btnPrimaryCls}
                onClick={() => handleTopup(topupAmount)}
              >
                {tFill(locale, "topupAmountCta", {
                  amount: formatMoney(topupAmount, currency, locale),
                })}
              </button>
            ) : null}
            <button type="button" className={btnSecondaryCls} onClick={onDone}>
              {t(locale, "bookingResultDone")}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          <>
            <QuoteSummary
              locale={locale}
              currency={quote.currency}
              cost={quote.cost}
              prepay={quote.prepay}
              remainder={quote.remainder}
              wallet={wallet}
              walletLoading={walletLoading}
              onTopup={
                wallet
                  ? (amount) => handleTopup(amount)
                  : undefined
              }
            />
            {quote.busy ? <p className="text-sm text-rose-600">{t(locale, "bookingConflict")}</p> : null}
          </>
        ) : null}

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        <div className="flex gap-2 pt-2">
          <button type="button" className={`flex-1 ${btnSecondaryCls}`} onClick={onClose}>
            {t(locale, "cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || quoting || !quote || quote.busy || quote.can_create === false}
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
