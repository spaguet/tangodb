import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import { formatMoney } from "../../lib/format";
import { slotEndOptions, slotStartOptions } from "../../lib/grid";
import {
  clearIdempotencyKey,
  getOrCreateIdempotencyKey,
  packScope,
} from "../../lib/idempotency";
import { addCalendarDays, orgIsoWeekday } from "../../lib/orgTime";
import { rpcCreatePack, rpcQuotePack } from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import type { QuotePackOccurrence } from "../../lib/types";
import { t, WEEKDAY_LABELS, type Locale } from "../../i18n/strings";

type PackSheetProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  organizationId: string;
  supabase: SupabaseClient;
  locationId: string;
  days: string[];
  onClose: () => void;
  onSuccess: () => void;
};

export default function PackSheet({
  locale,
  bootstrap,
  organizationId,
  supabase,
  locationId,
  days,
  onClose,
  onSuccess,
}: PackSheetProps) {
  const [validFrom, setValidFrom] = useState(days[0] ?? "");
  const [weekdays, setWeekdays] = useState<number[]>([orgIsoWeekday(bootstrap.timezone, validFrom)]);
  const [timeStart, setTimeStart] = useState("18:00");
  const [timeEnd, setTimeEnd] = useState("20:00");
  const [occurrences, setOccurrences] = useState<QuotePackOccurrence[] | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validTo = useMemo(() => addCalendarDays(validFrom, 27), [validFrom]);
  const endOptions = useMemo(() => slotEndOptions(timeStart), [timeStart]);
  const starts = useMemo(() => slotStartOptions(), []);

  const toggleWeekday = (d: number) => {
    setWeekdays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)
    );
  };

  useEffect(() => {
    if (weekdays.length === 0) return;
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
        if (!cancelled) setOccurrences(q.occurrences ?? []);
      } catch (err) {
        if (!cancelled) setError(t(locale, rpcErrorKey(err)));
      } finally {
        if (!cancelled) setQuoting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, locationId, validFrom, validTo, timeStart, timeEnd, weekdays, locale]);

  const totalCost = useMemo(() => {
    if (!occurrences?.length) return 0;
    return occurrences.reduce((s, o) => s + (o.cost ?? 0), 0);
  }, [occurrences]);

  const hasBusy = occurrences?.some((o) => o.busy) ?? false;
  const currency = occurrences?.[0]?.currency ?? bootstrap.currencyCode;

  const submit = async () => {
    if (weekdays.length === 0 || hasBusy) return;
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
      await rpcCreatePack(supabase, {
        location_id: locationId,
        valid_from: validFrom,
        valid_to: validTo,
        time_start: timeStart,
        time_end: timeEnd,
        weekdays,
        idempotency_key: idem,
      });
      clearIdempotencyKey(scope);
      onSuccess();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-t-2xl bg-[var(--tg-theme-bg-color,#0f172a)] p-4 pb-8 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{t(locale, "recurringPack")}</h2>
        <p className="text-xs opacity-70">{t(locale, "packActivateNote")}</p>

        <label className="flex flex-col gap-1 text-sm">
          <span>{t(locale, "packStart")}</span>
          <select
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <div className="text-sm">
          <span className="opacity-70">{t(locale, "weekdays")}</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <button
                key={d}
                type="button"
                className={`rounded-md px-2 py-1 text-xs ${
                  weekdays.includes(d) ? "bg-[var(--tg-theme-button-color,#38bdf8)]" : "bg-white/10"
                }`}
                onClick={() => toggleWeekday(d)}
              >
                {t(locale, WEEKDAY_LABELS[d])}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(locale, "startTime")}</span>
            <select
              className="rounded-lg border border-white/15 bg-white/5 px-2 py-2"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
            >
              {starts.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span>{t(locale, "endTime")}</span>
            <select
              className="rounded-lg border border-white/15 bg-white/5 px-2 py-2"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
            >
              {endOptions.map((te) => (
                <option key={te} value={te}>
                  {te}
                </option>
              ))}
            </select>
          </label>
        </div>

        {quoting ? (
          <p className="text-sm opacity-70">{t(locale, "quoteLoading")}</p>
        ) : occurrences ? (
          <div className="rounded-lg bg-white/5 p-3 text-sm space-y-1">
            <p>
              {t(locale, "cost")}: {formatMoney(totalCost, currency, locale)} ({occurrences.length}{" "}
              {locale === "en" ? "sessions" : "занятий"})
            </p>
            {hasBusy ? <p className="text-rose-300">{t(locale, "bookingConflict")}</p> : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}

        <div className="flex gap-2 pt-2">
          <button type="button" className="flex-1 rounded-lg border border-white/20 py-2.5" onClick={onClose}>
            {t(locale, "cancel")}
          </button>
          <button
            type="button"
            disabled={submitting || quoting || hasBusy || weekdays.length === 0}
            className="flex-1 rounded-lg bg-[var(--tg-theme-button-color,#38bdf8)] py-2.5 text-white disabled:opacity-50"
            onClick={() => void submit()}
          >
            {t(locale, "confirmBook")}
          </button>
        </div>
      </div>
    </div>
  );
}
