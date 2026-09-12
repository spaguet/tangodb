import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import {
  btnWeekNavCls,
  labelCls,
  occupancyLegendSwatchClass,
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
import type { LocationRow, MineSlot, OccupancyData, WalletData } from "../../lib/types";
import { t, tFill, type Locale } from "../../i18n/strings";
import { useVisibilityRefetch } from "../../hooks/useVisibilityRefetch";
import CancelMineBookingSheet from "./CancelMineBookingSheet";
import WeeklyOccupancyGrid from "./WeeklyOccupancyGrid";

export type PendingBooking = {
  locationId: string;
  date: string;
  start: string;
  packDays: string[];
};

type ScheduleTabProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  supabase: SupabaseClient;
  refreshKey: number;
  onTopup: (amount: number) => void;
  onOpenBooking: (booking: PendingBooking) => void;
  onRefreshAll?: () => void;
};

export default function ScheduleTab({
  locale,
  bootstrap,
  supabase,
  refreshKey,
  onTopup,
  onOpenBooking,
  onRefreshAll,
}: ScheduleTabProps) {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [cancelSlot, setCancelSlot] = useState<MineSlot | null>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const gridScrollRef = useRef<HTMLDivElement>(null);

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

  const handleGridScroll = useCallback(() => {
    const el = gridScrollRef.current;
    if (!el || el.scrollTop <= 12) return;
    setControlsCollapsed(true);
  }, []);

  const expandControls = useCallback(() => {
    setControlsCollapsed(false);
  }, []);

  if (loading && !occupancy && locations.length === 0) {
    return (
      <div className="flex justify-center bg-slate-50 py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50 text-slate-800">
      <div className="flex shrink-0 flex-col gap-3 px-4 pt-4 pb-3">
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

        {error ? <p className="text-sm text-rose-600">{error}</p> : null}

        {controlsCollapsed && weeks.length > 0 ? (
          <div className={`flex items-center gap-2 ${panelCls} px-3 py-2`}>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold leading-tight text-slate-800">{weekLabel}</p>
              <p className="truncate text-[10px] text-slate-500">
                {selectedLocation?.name ?? tFill(locale, "weekOf", { n: safeWeekIndex + 1, total: weeks.length })}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50"
              aria-label={t(locale, "scheduleControlsExpand")}
              aria-expanded={false}
              onClick={expandControls}
            >
              <span aria-hidden="true">▼</span>
            </button>
          </div>
        ) : (
          <>
            {locations.length > 1 ? (
              <div className="flex flex-col gap-1.5">
                <span className={labelCls}>{t(locale, "selectHall")}</span>
                <div className="flex flex-wrap gap-2" role="group" aria-label={t(locale, "selectHall")}>
                  {locations.map((loc) => (
                    <button
                      key={loc.id}
                      type="button"
                      className={`h-8 rounded-lg px-3 text-xs font-semibold transition-colors ${
                        locationId === loc.id ? weekChipActiveCls : weekChipCls
                      }`}
                      onClick={() => setLocationId(loc.id)}
                    >
                      {loc.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {selectedLocation?.bookable === false ? (
              <p className="text-xs leading-relaxed text-amber-800">{t(locale, "hallRatesIncomplete")}</p>
            ) : null}

            {weeks.length > 0 ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={btnWeekNavCls}
                    aria-label={t(locale, "prevWeek")}
                    disabled={safeWeekIndex <= 0}
                    onClick={() => setWeekIndex(Math.max(0, safeWeekIndex - 1))}
                  >
                    <ChevronIcon direction="left" />
                  </button>
                  <div className="flex min-w-0 flex-1 flex-col items-center">
                    <span className="text-center text-sm font-semibold leading-tight text-slate-800">
                      {weekLabel}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {tFill(locale, "weekOf", { n: safeWeekIndex + 1, total: weeks.length })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={btnWeekNavCls}
                    aria-label={t(locale, "nextWeek")}
                    disabled={safeWeekIndex >= weeks.length - 1}
                    onClick={() => setWeekIndex(Math.min(weeks.length - 1, safeWeekIndex + 1))}
                  >
                    <ChevronIcon direction="right" />
                  </button>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <span className={occupancyLegendSwatchClass("free")} />
                    {t(locale, "free")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className={occupancyLegendSwatchClass("busy")} />
                    {t(locale, "busy")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className={occupancyLegendSwatchClass("mine")} />
                    {t(locale, "mine")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className={occupancyLegendSwatchClass("mine_hold")} />
                    {t(locale, "mineHold")}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className={occupancyLegendSwatchClass("mine_debt")} />
                    {t(locale, "mineDebt")}
                  </span>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>

      {occupancy && weekDays.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          <section className={`${panelCls} flex min-h-0 flex-1 flex-col overflow-hidden`}>
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <h3 className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-800">
                {selectedLocation?.name ?? t(locale, "selectHall")}
              </h3>
            </div>
            <div
              ref={gridScrollRef}
              className="isolate min-h-0 flex-1 overflow-auto [-webkit-overflow-scrolling:touch]"
              onScroll={handleGridScroll}
            >
              <WeeklyOccupancyGrid
                locale={locale}
                timezone={bootstrap.timezone}
                serverNow={bootstrap.serverNow}
                weekDays={weekDays}
                occupancy={occupancy}
                addonActive={bootstrap.addonActive}
                onFreeCell={(date, start) => {
                  if (!locationId) return;
                  onOpenBooking({ locationId, date, start, packDays: days });
                }}
                onMineCell={setCancelSlot}
              />
            </div>
          </section>
        </div>
      ) : null}

      {cancelSlot ? (
        <CancelMineBookingSheet
          locale={locale}
          timezone={bootstrap.timezone}
          serverNow={bootstrap.serverNow}
          supabase={supabase}
          slot={cancelSlot}
          onClose={() => setCancelSlot(null)}
          onDone={() => {
            setCancelSlot(null);
            onRefreshAll?.();
            void refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      {direction === "left" ? (
        <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}
