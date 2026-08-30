import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BootstrapData } from "../../lib/auth";
import { slotStartOptions } from "../../lib/grid";
import { daySlotStates, type SlotState } from "../../lib/occupancyMerge";
import { addCalendarDays, formatShortDate } from "../../lib/orgTime";
import { rpcGetOccupancy, rpcListLocations } from "../../lib/rpc";
import { rpcErrorKey } from "../../lib/rpcErrors";
import type { LocationRow, MineSlot, OccupancyData } from "../../lib/types";
import { useVisibilityRefetch } from "../../hooks/useVisibilityRefetch";
import { t, type Locale } from "../../i18n/strings";
import BookingSheet from "./BookingSheet";
import PackSheet from "./PackSheet";

type ScheduleTabProps = {
  locale: Locale;
  bootstrap: BootstrapData;
  organizationId: string;
  supabase: SupabaseClient;
  onBooked: () => void;
};

export default function ScheduleTab({
  locale,
  bootstrap,
  organizationId,
  supabase,
  onBooked,
}: ScheduleTabProps) {
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [locationId, setLocationId] = useState<string>("");
  const [occupancy, setOccupancy] = useState<OccupancyData | null>(null);
  const [selectedDay, setSelectedDay] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookingSlot, setBookingSlot] = useState<{ date: string; start: string } | null>(null);
  const [packOpen, setPackOpen] = useState(false);

  const slotStarts = useMemo(() => slotStartOptions(), []);
  const days = occupancy?.window
    ? (() => {
        const list: string[] = [];
        for (let i = 0; i < 21; i++) {
          list.push(addCalendarDays(occupancy.window.from, i));
        }
        return list;
      })()
    : [];

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
    if (!selectedDay) setSelectedDay(data.window.from);
  }, [supabase, locationId, selectedDay]);

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

  const dayStates = useMemo(() => {
    if (!occupancy || !selectedDay) return new Map<string, SlotState>();
    return daySlotStates(
      selectedDay,
      slotStarts,
      occupancy.busy,
      occupancy.mine as MineSlot[]
    );
  }, [occupancy, selectedDay, slotStarts]);

  const findMineAt = (start: string): MineSlot | undefined => {
    if (!occupancy || !selectedDay) return undefined;
    return (occupancy.mine as MineSlot[]).find(
      (m) => m.date === selectedDay && m.time_start.slice(0, 5) === start.slice(0, 5)
    );
  };

  const slotClass = (state: SlotState): string => {
    switch (state) {
      case "free":
        return "bg-emerald-500/15 border-emerald-500/30 text-emerald-100";
      case "busy":
        return "bg-rose-500/15 border-rose-500/25 text-rose-100/80";
      case "mine":
        return "bg-sky-500/25 border-sky-400/50 text-sky-50 ring-1 ring-sky-400/40";
      case "mine_hold":
        return "slot-hold border-slate-400/40 text-slate-200";
      default:
        return "bg-white/5 border-white/10";
    }
  };

  const slotLabel = (state: SlotState): string => {
    switch (state) {
      case "free":
        return t(locale, "free");
      case "busy":
        return t(locale, "busy");
      case "mine":
        return t(locale, "mine");
      case "mine_hold":
        return t(locale, "mineHold");
      default:
        return "";
    }
  };

  const onSlotTap = (start: string, state: SlotState) => {
    if (state === "mine" || state === "mine_hold") {
      const mine = findMineAt(start);
      if (mine) onBooked();
      return;
    }
    if (state === "free" && bootstrap.addonActive) {
      setBookingSlot({ date: selectedDay, start });
    }
  };

  if (loading && !occupancy) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 rounded-full border-2 border-[var(--tg-theme-button-color,#38bdf8)] border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 px-4 pb-6">
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

      <div className="flex gap-1 overflow-x-auto pb-1 -mx-1 px-1">
        {days.map((d) => (
          <button
            key={d}
            type="button"
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs ${
              d === selectedDay ? "bg-[var(--tg-theme-button-color,#38bdf8)] text-white" : "bg-white/5"
            }`}
            onClick={() => setSelectedDay(d)}
          >
            {formatShortDate(d, locale === "en" ? "en" : "ru")}
          </button>
        ))}
      </div>

      <div className="grid gap-1.5">
        {slotStarts.map((start) => {
          const state = dayStates.get(start) ?? "free";
          return (
            <button
              key={start}
              type="button"
              disabled={state === "busy"}
              className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${slotClass(state)} disabled:opacity-60`}
              onClick={() => onSlotTap(start, state)}
            >
              <span>{start}</span>
              <span className="text-xs opacity-80">{slotLabel(state)}</span>
            </button>
          );
        })}
      </div>

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
