import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import {
  btnOpenCls,
  labelCls,
  panelCls,
  weekChipActiveCls,
  weekChipCls,
} from "../../lib/crmUi";
import { formatMoney } from "../../lib/format";
import {
  formatWeekRangeLabel,
  occupancyDaysFromWindow,
  occupancyWeeksFromWindow,
} from "../../lib/orgTime";
import { rpcGetOccupancy, rpcGetWallet, rpcListLocations } from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import type { LocationRow, OccupancyData, WalletData } from "../../lib/types";
import { t, tFill, type Locale } from "../../i18n/strings";
import { useVisibilityRefetch } from "../../hooks/useVisibilityRefetch";
import BookingSheet from "./BookingSheet";
import PackSheet from "./PackSheet";
import WeeklyOccupancyGrid from "./WeeklyOccupancyGrid";

type ScheduleTabProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  organizationId: string;
  supabase: SupabaseClient;
  refreshKey: number;
  onBooked: () => void;
  onOpenMine: (rentalId?: string) => void;
  onTopup: (amount: number) => void;
};

export default function ScheduleTab({
  locale,
  bootstrap,
  organizationId,
  supabase,
  refreshKey,
  onBooked,
  onOpenMine,
  onTopup,
}: ScheduleTabProps) {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<{ date: string; start: string } | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [wallet, setWallet] = useState<WalletData | null>(null);

  const days = occupancy?.window ? occupancyDaysFromWindow(occupancy.window.from) : [];
  const weeks = occupancy?.window ? occupancyWeeksFromWindow(occupancy.window.from) : [];
  const safeWeekIndex = weeks.length === 0 ? 0 : Math.min(weekIndex, weeks.length - 1);
  const weekDays = weeks[safeWeekIndex] ?? [];

  const loadLocations = useCallback(async () => {
    const rows = await rpcListLocations(supabase);
    setLocations(rows);
    setLocationId((prev) => {
      if (rows.length === 0) return "";
      if (rows.some((row) => row.id === prev)) return prev;
      return rows[0].id;
    });
  }, [supabase]);

  const loadOccupancy = useCallback(async () => {
    if (!locationId) return;
    setError(null);
    const data = await rpcGetOccupancy(supabase, locationId);
    setOccupancy(data);
  }, [supabase, locationId]);

  const refresh = useCallback(async () => {
    try {
      await loadLocations();
      await loadOccupancy();
      const w = await rpcGetWallet(supabase, 1, 0);
      setWallet(w);
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    }
  }, [loadLocations, loadOccupancy, locale, supabase]);

  useVisibilityRefetch(() => {
    void refresh();
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadLocations();
      } catch (err) {
        if (!cancelled) setError(t(locale, rpcErrorKey(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadLocations, locale]);

  useEffect(() => {
    if (!locationId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        await loadOccupancy();
      } catch (err) {
        if (!cancelled) setError(t(locale, rpcErrorKey(err)));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [locationId, loadOccupancy, locale]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const w = await rpcGetWallet(supabase, 1, 0);
        if (!cancelled) setWallet(w);
      } catch {
        if (!cancelled) setWallet(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    if (refreshKey === 0) return;
    void refresh();
  }, [refreshKey, refresh]);

  const localeTag = locale === "en" ? "en" : "ru";
  const debtAmount = wallet?.debt_amount ?? 0;
  const currency = bootstrap.currencyCode;
  const selectedLocation = locations.find((loc) => loc.id === locationId);
  const contactSuffix = bootstrap.contactPhone
    ? locale === "en"
      ? ` (${bootstrap.contactPhone})`
      : `: ${bootstrap.contactPhone}`
    : bootstrap.chatUrl
      ? locale === "en"
        ? " via studio chat"
        : " в чате студии"
      : "";
  const weekLabel = useMemo(() => {
    if (weekDays.length < 2) return "";
    return formatWeekRangeLabel(weekDays[0], weekDays[weekDays.length - 1], localeTag);
  }, [weekDays, localeTag]);

  if (loading && !occupancy && locations.length === 0) {
    return (
      <div className="flex justify-center bg-slate-50 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 bg-slate-50 pb-4 text-slate-800">
      <div className="flex flex-col gap-3 px-4 pt-4">
        {!bootstrap.addonActive ? (
          <p className="text-xs leading-relaxed text-slate-500">{t(locale, "addonInactiveCreate")}</p>
        ) : null}

        {bootstrap.bookingBanned ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-relaxed text-rose-900">
            {t(locale, "bookingBanned")}
          </p>
        ) : debtAmount > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <p>{t(locale, "debtBlocked")}</p>
            <button
              type="button"
              className="mt-2 font-semibold text-indigo-700 hover:underline"
              onClick={() => onTopup(debtAmount)}
            >
              {t(locale, "repayDebtCta")} · {formatMoney(debtAmount, currency, locale)}
            </button>
          </div>
        ) : null}

        {!loading && locations.length === 0 ? (
          <div className={`${panelCls} space-y-2 p-3 text-sm text-slate-600`}>
            <p>{t(locale, "noHalls")}</p>
            <p className="text-xs leading-relaxed">
              {tFill(locale, "noHallsContact", { contact: contactSuffix })}
            </p>
          </div>
        ) : null}

        {locations.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className={labelCls}>{t(locale, "selectHall")}</span>
            {locations.length > 1 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label={t(locale, "selectHall")}>
                {locations.map((loc) => (
                  <button
                    key={loc.id}
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      locationId === loc.id ? weekChipActiveCls : weekChipCls
                    }`}
                    onClick={() => setLocationId(loc.id)}
                  >
                    {loc.name}
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm font-medium text-slate-700">{locations[0].name}</p>
            )}
            {selectedLocation?.bookable === false ? (
              <p className="text-xs leading-relaxed text-amber-800">{t(locale, "hallRatesIncomplete")}</p>
            ) : null}
          </div>
        ) : null}

        {bootstrap.addonActive ? (
          <button type="button" className={btnOpenCls} onClick={() => setPackOpen(true)}>
            {t(locale, "recurringPack")}
          </button>
        ) : null}

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {weeks.length > 0 ? (
          <div className={`flex flex-col gap-2 ${panelCls} p-3`}>
            <div className="flex min-w-0 flex-col items-center">
              <span className="text-center text-sm font-semibold text-slate-800 leading-tight">
                {weekLabel}
              </span>
              <span className="text-[10px] text-slate-400">
                {tFill(locale, "weekOf", { n: safeWeekIndex + 1, total: weeks.length })}
              </span>
            </div>
            <div className="flex gap-1">
              {weeks.map((week, i) => (
                <button
                  key={week[0]}
                  type="button"
                  className={`min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-[10px] leading-tight ${
                    i === safeWeekIndex ? weekChipActiveCls : weekChipCls
                  }`}
                  onClick={() => setWeekIndex(i)}
                >
                  {formatWeekRangeLabel(week[0], week[week.length - 1], localeTag, false)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm border border-slate-200 bg-white" />
                {t(locale, "free")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-400 ring-1 ring-inset ring-slate-500" />
                {t(locale, "busy")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-slate-600" />
                {t(locale, "mine")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="slot-hold h-2.5 w-2.5 rounded-sm border border-slate-700" />
                {t(locale, "mineHold")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-600 ring-1 ring-inset ring-rose-700" />
                {t(locale, "mineDebt")}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {occupancy && weekDays.length > 0 ? (
        <div className="border-t border-slate-200">
          <WeeklyOccupancyGrid
            locale={locale}
            timezone={bootstrap.timezone}
            serverNow={bootstrap.serverNow}
            weekDays={weekDays}
            occupancy={occupancy}
            addonActive={bootstrap.addonActive}
            onFreeCell={(date, start) => setBookingSlot({ date, start })}
            onMineCell={(rentalId) => onOpenMine(rentalId)}
          />
        </div>
      ) : null}

      {bookingSlot && locationId ? (
        <BookingSheet
          locale={locale}
          bootstrap={bootstrap}
          serverNow={bootstrap.serverNow}
          organizationId={organizationId}
          supabase={supabase}
          locationId={locationId}
          date={bookingSlot.date}
          defaultStart={bookingSlot.start}
          packDays={days}
          onClose={() => setBookingSlot(null)}
          onDone={() => {
            setBookingSlot(null);
            void refresh();
            onBooked();
          }}
          onTopup={onTopup}
        />
      ) : null}

      {packOpen && locationId ? (
        <PackSheet
          locale={locale}
          bootstrap={bootstrap}
          organizationId={organizationId}
          supabase={supabase}
          locationId={locationId}
          days={days}
          onClose={() => setPackOpen(false)}
          onSuccess={() => {
            setPackOpen(false);
            void refresh();
            onBooked();
          }}
          onTopup={onTopup}
        />
      ) : null}
    </div>
  );
}
