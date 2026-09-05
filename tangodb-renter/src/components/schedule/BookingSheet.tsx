import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import { btnPrimaryCls, btnSecondaryCls, fieldCls, labelCls, successBannerCls, weekChipActiveCls, weekChipCls } from "../../lib/crmUi";
import { formatHoldDeadline, formatMoney } from "../../lib/format";
import { useHoldCountdown } from "../../hooks/useServerClock";
import { slotEndOptions, slotStartOptions, snapTime } from "../../lib/grid";
import {
  bookingScope,
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
  packScope,
} from "../../lib/idempotency";
import {
  addCalendarDays,
  formatShortDate,
  formatTimeRange,
  orgIsoWeekday,
} from "../../lib/orgTime";
import { validFromInWeekdays, weekdaysIncludingDate } from "../../lib/packWeekdays";
import {
  rpcCreateBooking,
  rpcCreatePack,
  rpcGetWallet,
  rpcQuoteOneTime,
  rpcQuotePack,
} from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import type {
  PackCreateResult,
  QuoteOneTime,
  QuotePackOccurrence,
  RentalItem,
  WalletData,
} from "../../lib/types";
import { t, tFill, WEEKDAY_LABELS, type Locale } from "../../i18n/strings";
import QuoteSummary, { topupAmountFromWallet } from "./QuoteSummary";

type BookingMode = "one_time" | "recurring";

type BookingSheetProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  serverNow: string;
  organizationId: string;
  supabase: SupabaseClient;
  locationId: string;
  date: string;
  defaultStart: string;
  packDays: string[];
  onClose: () => void;
  onDone: () => void;
  onTopup: (amount: number) => void;
};

const ACTIVE_LIFECYCLES = new Set(["active", "prepaid_charged", "settled"]);
const weekdayActiveCls = "bg-indigo-600 text-white border border-indigo-600";
const weekdayIdleCls = "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50";

export default function BookingSheet({
  locale,
  bootstrap,
  serverNow,
  organizationId,
  supabase,
  locationId,
  date,
  defaultStart,
  packDays,
  onClose,
  onDone,
  onTopup,
}: BookingSheetProps) {
  const timezone = bootstrap.timezone;
  const [mode, setMode] = useState<BookingMode>("one_time");
  const [timeStart, setTimeStart] = useState(snapTime(defaultStart));
  const [timeEnd, setTimeEnd] = useState("");
  const [quote, setQuote] = useState<QuoteOneTime | null>(null);
  const [validFrom, setValidFrom] = useState(date);
  const [weekdays, setWeekdays] = useState<number[]>([orgIsoWeekday(timezone, date)]);
  const [occurrences, setOccurrences] = useState<QuotePackOccurrence[] | null>(null);
  const [packCanCreate, setPackCanCreate] = useState(true);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<RentalItem | null>(null);
  const [createdPack, setCreatedPack] = useState<PackCreateResult | null>(null);

  const validTo = useMemo(() => addCalendarDays(validFrom, 27), [validFrom]);
  const countdown = useHoldCountdown(
    created?.hold_expires_at ?? createdPack?.hold_expires_at ?? null,
    created?.lifecycle === "awaiting_payment" || createdPack?.series_status === "awaiting_payment",
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
    if (mode !== "one_time" || !timeEnd) return;
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
  }, [supabase, locationId, date, timeStart, timeEnd, locale, mode]);

  useEffect(() => {
    if (mode !== "recurring" || weekdays.length === 0) return;
    let cancelled = false;
    (async () => {
      setQuoting(true);
      setError(null);
      try {
        const q = await rpcQuotePack(supabase, {
          location_id: locationId,
          valid_from: validFrom,
          valid_to: validTo,
          time_start: timeStart,
          time_end: timeEnd,
          weekdays,
        });
        if (!cancelled) {
          setOccurrences(q.occurrences ?? []);
          setPackCanCreate(q.can_create !== false);
        }
      } catch (err) {
        if (!cancelled) setError(t(locale, rpcErrorKey(err)));
      } finally {
        if (!cancelled) setQuoting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, locationId, validFrom, validTo, timeStart, timeEnd, weekdays, locale, mode]);

  const packTotals = useMemo(() => {
    if (!occurrences?.length) {
      return { cost: 0, prepay: 0, remainder: 0, currency: bootstrap.currencyCode };
    }
    return occurrences.reduce(
      (acc, o) => ({
        cost: acc.cost + (o.cost ?? 0),
        prepay: acc.prepay + (o.prepay ?? 0),
        remainder: acc.remainder + (o.remainder ?? 0),
        currency: o.currency ?? acc.currency,
      }),
      { cost: 0, prepay: 0, remainder: 0, currency: bootstrap.currencyCode }
    );
  }, [occurrences, bootstrap.currencyCode]);

  const hasBusy = occurrences?.some((o) => o.busy) ?? false;
  const validFromOk = validFromInWeekdays(timezone, validFrom, weekdays);
  const sessionCount = createdPack?.occurrence_count ?? occurrences?.length ?? 0;

  const toggleWeekday = (d: number) => {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  };

  const handleValidFromChange = (next: string) => {
    setValidFrom(next);
    setWeekdays((prev) => weekdaysIncludingDate(prev, timezone, next));
  };

  const submitOneTime = async () => {
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

  const submitRecurring = async () => {
    if (weekdays.length === 0 || !validFromOk || hasBusy || !packCanCreate || !timeEnd) return;
    setSubmitting(true);
    setError(null);
    const scope = packScope(
      organizationId,
      locationId,
      validFrom,
      validTo,
      timeStart,
      timeEnd,
      weekdays
    );
    const idem = getOrCreateIdempotencyKey(scope);
    try {
      const result = await rpcCreatePack(supabase, {
        location_id: locationId,
        valid_from: validFrom,
        valid_to: validTo,
        time_start: timeStart,
        time_end: timeEnd,
        weekdays,
        idempotency_key: idem,
      });
      clearIdempotencyKey(scope);
      setCreatedPack({
        ...result,
        occurrence_count: result.occurrence_count ?? occurrences?.length ?? 0,
      });
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

  const sheetCls =
    "max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-4 pb-8 text-slate-800 shadow-xl [-webkit-overflow-scrolling:touch]";

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
        <div className={sheetCls} onClick={(e) => e.stopPropagation()}>
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
            <p className={successBannerCls}>
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

  if (createdPack) {
    const currency = packTotals.currency;
    const prepay = packTotals.prepay;
    const isHold = createdPack.series_status === "awaiting_payment";
    const active = createdPack.series_status === "active";
    const deadline = formatHoldDeadline(createdPack.hold_expires_at ?? null, localeTag, timezone);
    const topupAmount = wallet && isHold ? topupAmountFromWallet(wallet, prepay) : prepay > 0 ? prepay : 0;

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={onClose}>
        <div className={sheetCls} onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-semibold text-slate-900">{t(locale, "packResultTitle")}</h2>
          <p className="text-sm text-slate-500">
            {formatTimeRange(timeStart, timeEnd)} · {sessionCount}{" "}
            {locale === "en" ? "sessions" : "занятий"}
          </p>

          {isHold ? (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-medium">
                {deadline
                  ? tFill(locale, "packNeedPrepayBy", {
                      amount: formatMoney(topupAmount, currency, locale),
                      time: deadline,
                    })
                  : tFill(locale, "packNeedPrepay", {
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
          ) : active ? (
            <p className={successBannerCls}>
              {tFill(locale, "packActive", { count: String(sessionCount) })}
            </p>
          ) : (
            <p className="text-sm text-slate-600">{createdPack.series_status}</p>
          )}

          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
            {(occurrences ?? []).map((o) => (
              <li key={o.date}>
                {formatShortDate(o.date, localeTag)} · {formatTimeRange(o.time_start, o.time_end)}
              </li>
            ))}
          </ul>

          <div className="flex flex-col gap-2 pt-2">
            {isHold && topupAmount > 0 ? (
              <button type="button" className={btnPrimaryCls} onClick={() => handleTopup(topupAmount)}>
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

  const oneTimeDisabled =
    submitting || quoting || !quote || quote.busy || quote.can_create === false || !timeEnd;
  const recurringDisabled =
    submitting ||
    quoting ||
    hasBusy ||
    weekdays.length === 0 ||
    !validFromOk ||
    !packCanCreate ||
    !timeEnd ||
    !occurrences?.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40" onClick={onClose}>
      <div className={sheetCls} onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-900">{t(locale, "bookSlot")}</h2>

        <div className="flex gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label={t(locale, "bookSlot")}>
          <button
            type="button"
            className={`min-w-0 flex-1 rounded-md px-2 py-2 text-xs font-semibold ${
              mode === "one_time" ? weekChipActiveCls : weekChipCls
            }`}
            onClick={() => setMode("one_time")}
          >
            {t(locale, "bookingModeOneTime")}
          </button>
          <button
            type="button"
            className={`min-w-0 flex-1 rounded-md px-2 py-2 text-xs font-semibold ${
              mode === "recurring" ? weekChipActiveCls : weekChipCls
            }`}
            onClick={() => setMode("recurring")}
          >
            {t(locale, "bookingModeRecurring")}
          </button>
        </div>

        {mode === "one_time" ? (
          <p className="text-sm text-slate-500">
            {date} · {formatTimeRange(timeStart, timeEnd || "…")}
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-500">{t(locale, "packActivateNote")}</p>
            <p className="text-xs text-slate-500">{t(locale, "packInsufficientHint")}</p>
          </>
        )}

        {mode === "recurring" ? (
          <label className="flex flex-col gap-1">
            <span className={labelCls}>{t(locale, "packStart")}</span>
            <select className={fieldCls} value={validFrom} onChange={(e) => handleValidFromChange(e.target.value)}>
              {packDays.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {mode === "recurring" ? (
          <div>
            <span className={labelCls}>{t(locale, "weekdays")}</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`rounded-md px-2 py-1 text-xs font-semibold ${
                    weekdays.includes(d) ? weekdayActiveCls : weekdayIdleCls
                  }`}
                  onClick={() => toggleWeekday(d)}
                >
                  {t(locale, WEEKDAY_LABELS[d])}
                </button>
              ))}
            </div>
            {!validFromOk ? (
              <p className="mt-1 text-xs text-rose-600">{t(locale, "packStartWeekdayMismatch")}</p>
            ) : null}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2">
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
        </div>

        {quoting ? (
          <p className="text-sm text-slate-500">{t(locale, "quoteLoading")}</p>
        ) : mode === "one_time" && quote ? (
          <>
            <QuoteSummary
              locale={locale}
              currency={quote.currency}
              cost={quote.cost}
              prepay={quote.prepay}
              remainder={quote.remainder}
              wallet={wallet}
              walletLoading={walletLoading}
              onTopup={wallet ? (amount) => handleTopup(amount) : undefined}
            />
            {quote.busy ? <p className="text-sm text-rose-600">{t(locale, "bookingConflict")}</p> : null}
          </>
        ) : mode === "recurring" && occurrences?.length ? (
          <>
            <div>
              <p className={labelCls}>{t(locale, "packDatesTitle")}</p>
              <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
                {occurrences.map((o) => (
                  <li key={o.date}>
                    {formatShortDate(o.date, localeTag)} · {formatTimeRange(o.time_start, o.time_end)}
                  </li>
                ))}
              </ul>
            </div>
            <QuoteSummary
              locale={locale}
              currency={packTotals.currency}
              cost={packTotals.cost}
              prepay={packTotals.prepay}
              remainder={packTotals.remainder}
              wallet={wallet}
              walletLoading={walletLoading}
              sessionCount={occurrences.length}
              holdNote={t(locale, "packHoldDuration")}
              onTopup={(amount) => {
                onTopup(amount);
                onClose();
              }}
            />
            {hasBusy ? <p className="text-sm text-rose-600">{t(locale, "bookingConflict")}</p> : null}
          </>
        ) : null}

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        <div className="flex gap-2 pt-2">
          <button type="button" className={`flex-1 ${btnSecondaryCls}`} onClick={onClose}>
            {t(locale, "cancel")}
          </button>
          <button
            type="button"
            disabled={mode === "one_time" ? oneTimeDisabled : recurringDisabled}
            className={`flex-1 ${btnPrimaryCls}`}
            onClick={() => void (mode === "one_time" ? submitOneTime() : submitRecurring())}
          >
            {t(locale, "confirmBook")}
          </button>
        </div>
      </div>
    </div>
  );
}
