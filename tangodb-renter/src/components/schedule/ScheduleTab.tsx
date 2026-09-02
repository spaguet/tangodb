import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import {
  formatWeekRangeLabel,
  occupancyDaysFromWindow,
  occupancyWeeksFromWindow,
} from "../../lib/orgTime";
import { rpcGetOccupancy, rpcListLocations } from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import type { LocationRow, OccupancyData } from "../../lib/types";
import { useVisibilityRefetch } from "../../hooks/useVisibilityRefetch";
import { t, tFill, type Locale } from "../../i18n/strings";
import BookingSheet from "./BookingSheet";
import PackSheet from "./PackSheet";
import WeeklyOccupancyGrid from "./WeeklyOccupancyGrid";

type ScheduleTabProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  organizationId: string;
  supabase: SupabaseClient;
  onBooked: () => void;
  onOpenMine: () => void;
};

export default function ScheduleTab({
  locale,
  bootstrap,
  organizationId,
  supabase,
  onBooked,
  onOpenMine,
}: ScheduleTabProps) {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [weekIndex, setWeekIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<{ date: string; start: string } | null>(null);
  const [packOpen, setPackOpen] = useState(false);

  const days = occupancy?.window ? occupancyDaysFromWindow(occupancy.window.from) : [];
  const weeks = occupancy?.window ? occupancyWeeksFromWindow(occupancy.window.from) : [];
  const safeWeekIndex = weeks.length === 0 ? 0 : Math.min(weekIndex, weeks.length - 1);
  const weekDays = weeks[safeWeekIndex] ?? [];

  const loadLocations = useCallback(async () => {
    const rows = await rpcListLocations(supabase);
    setLocations(rows);
    if (rows.length === 1) setLocationId(rows[0].id);
    else if (rows.length > 0 && !locationId) setLocationId(rows[0].id);
  }, [supabase, locationId]);

  const loadOccupancy = useCallback(async () => {
    if (!locationId) return;
    setError(null);
    const data = await rpcGetOccupancy(supabase, locationId);
    setOccupancy(data);
  }, [supabase, locationId]);

  const refresh = useCallback(async () => {
    try {
      await loadOccupancy();
    } catch (err) {
      setError(t(locale, rpcErrorKey(err)));
    }
  }, [loadOccupancy, locale]);

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

  useVisibilityRefetch(refresh);

  const localeTag = locale === "en" ? "en" : "ru";
  const weekLabel = useMemo(() => {
    if (weekDays.length < 2) return "";
    return formatWeekRangeLabel(weekDays[0], weekDays[weekDays.length - 1], localeTag);
  }, [weekDays, localeTag]);

  if (loading && !occupancy) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 rounded-full border-2 border-[var(--tg-theme-button-color,#38bdf8)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-3 px-4">
        {!bootstrap.addonActive ? (
          <p className="text-xs opacity-70 leading-relaxed">{t(locale, "addonInactiveCreate")}</p>
        ) : null}

        {locations.length > 1 ? (
          <label className="flex flex-col gap-1 text-sm">
            <span className="opacity-70">{t(locale, "selectHall")}</span>
            <select
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ) : locations[0] ? (
          <p className="text-sm opacity-80">{locations[0].name}</p>
        ) : null}

        {bootstrap.addonActive ? (
          <button
            type="button"
            className="rounded-lg border border-white/20 px-3 py-2 text-sm"
            onClick={() => setPackOpen(true)}
          >
            {t(locale, "recurringPack")}
          </button>
        ) : null}

        {error ? <p className="text-sm text-rose-300">{error}</p> : null}

        {weeks.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label={t(locale, "prevWeek")}
                disabled={safeWeekIndex === 0}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-lg disabled:opacity-30"
                onClick={() => setWeekIndex((n) => Math.max(0, n - 1))}
              >
                ‹
              </button>
              <div className="flex min-w-0 flex-1 flex-col items-center">
                <span className="text-sm font-semibold text-center leading-tight">{weekLabel}</span>
                <span className="text-[10px] opacity-60">
                  {tFill(locale, "weekOf", { n: safeWeekIndex + 1, total: weeks.length })}
                </span>
                {safeWeekIndex !== 0 ? (
                  <button
                    type="button"
                    className="text-[10px] font-semibold text-[var(--tg-theme-button-color,#38bdf8)]"
                    onClick={() => setWeekIndex(0)}
                  >
                    {t(locale, "thisWeek")}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                aria-label={t(locale, "nextWeek")}
                disabled={safeWeekIndex >= weeks.length - 1}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/5 text-lg disabled:opacity-30"
                onClick={() => setWeekIndex((n) => Math.min(weeks.length - 1, n + 1))}
              >
                ›
              </button>
            </div>
            <div className="flex gap-1">
              {weeks.map((week, i) => (
                <button
                  key={week[0]}
                  type="button"
                  className={`min-w-0 flex-1 rounded-lg px-1.5 py-1.5 text-[10px] leading-tight ${
                    i === safeWeekIndex
                      ? "bg-[var(--tg-theme-button-color,#38bdf8)] text-white"
                      : "bg-white/5"
                  }`}
                  onClick={() => setWeekIndex(i)}
                >
                  {formatWeekRangeLabel(week[0], week[week.length - 1], localeTag, false)}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] opacity-75">
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-emerald-500/50" />
                {t(locale, "free")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-rose-500/40" />
                {t(locale, "busy")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm bg-sky-500/60" />
                {t(locale, "mine")}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="slot-hold h-2.5 w-2.5 rounded-sm border border-white/20" />
                {t(locale, "mineHold")}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {occupancy && weekDays.length > 0 ? (
        <div className="min-h-0 flex-1">
          <WeeklyOccupancyGrid
            locale={locale}
            timezone={bootstrap.timezone}
            weekDays={weekDays}
            occupancy={occupancy}
            addonActive={bootstrap.addonActive}
            onFreeCell={(date, start) => setBookingSlot({ date, start })}
            onMineCell={() => onOpenMine()}
          />
        </div>
      ) : null}

      {bookingSlot && locationId ? (
        <BookingSheet
          locale={locale}
          organizationId={organizationId}
          supabase={supabase}
          locationId={locationId}
          date={bookingSlot.date}
          defaultStart={bookingSlot.start}
          onClose={() => setBookingSlot(null)}
          onSuccess={() => {
            setBookingSlot(null);
            void refresh();
            onBooked();
          }}
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
        />
      ) : null}
    </div>
  );
}
