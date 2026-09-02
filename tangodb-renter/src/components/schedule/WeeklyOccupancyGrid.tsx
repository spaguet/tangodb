import { Fragment, useMemo } from "react";
import { slotStartOptions } from "../../lib/grid";
import { calendarDayNumber, orgLocalDate } from "../../lib/orgTime";
import {
  daySlotStates,
  findOverlappingMine,
  type SlotState,
} from "../../lib/occupancyMerge";
import type { OccupancyData } from "../../lib/types";
import { t, WEEKDAY_LABELS, type Locale, type MessageKey } from "../../i18n/strings";

type WeeklyOccupancyGridProps = {
  locale: Locale;
  timezone: string;
  weekDays: string[];
  occupancy: OccupancyData;
  addonActive: boolean;
  onFreeCell: (date: string, start: string) => void;
  onMineCell: (date: string, start: string) => void;
};

function cellClass(state: SlotState, isToday: boolean): string {
  const todayTint = isToday ? "ring-inset ring-1 ring-white/15" : "";
  switch (state) {
    case "free":
      return `bg-emerald-500/20 hover:bg-emerald-400/30 text-emerald-50 ${todayTint}`;
    case "busy":
      return `bg-rose-500/20 text-rose-100/70 ${todayTint}`;
    case "mine":
      return `bg-sky-500/35 ring-1 ring-inset ring-sky-300/50 text-sky-50 ${todayTint}`;
    case "mine_hold":
      return `slot-hold text-slate-100 ${todayTint}`;
    default:
      return `bg-white/5 ${todayTint}`;
  }
}

function stateKey(state: SlotState): MessageKey {
  return state === "mine_hold" ? "mineHold" : state;
}

function weekdayKey(columnIndex: number): MessageKey {
  return WEEKDAY_LABELS[columnIndex + 1] ?? "mon";
}

export default function WeeklyOccupancyGrid({
  locale,
  timezone,
  weekDays,
  occupancy,
  addonActive,
  onFreeCell,
  onMineCell,
}: WeeklyOccupancyGridProps) {
  const slotStarts = useMemo(() => slotStartOptions(), []);
  const todayIso = orgLocalDate(timezone);

  const statesByDate = useMemo(() => {
    const map = new Map<string, Map<string, SlotState>>();
    for (const date of weekDays) {
      map.set(date, daySlotStates(date, slotStarts, occupancy.busy, occupancy.mine));
    }
    return map;
  }, [weekDays, slotStarts, occupancy.busy, occupancy.mine]);

  const onCell = (date: string, start: string, state: SlotState) => {
    if (state === "mine" || state === "mine_hold") {
      if (findOverlappingMine(date, start, occupancy.mine)) onMineCell(date, start);
      return;
    }
    if (state === "free" && addonActive) onFreeCell(date, start);
  };

  return (
    <div className="h-full min-h-0 overflow-auto [-webkit-overflow-scrolling:touch]">
      <div
        className="grid min-w-[640px]"
        style={{
          gridTemplateColumns: `2.5rem repeat(${weekDays.length}, minmax(4.25rem, 1fr))`,
        }}
      >
        <div
          className="sticky top-0 left-0 z-30 h-11 border-b border-r border-white/10 bg-[var(--tg-theme-bg-color,#0f172a)]"
          aria-hidden
        />
        {weekDays.map((date, columnIndex) => {
          const isToday = date === todayIso;
          return (
            <div
              key={`h-${date}`}
              className={`sticky top-0 z-20 flex h-11 flex-col items-center justify-center border-b border-r border-white/10 ${
                isToday
                  ? "bg-[color-mix(in_srgb,var(--tg-theme-bg-color,#0f172a)_78%,white)]"
                  : "bg-[var(--tg-theme-bg-color,#0f172a)]"
              }`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider opacity-60 leading-none">
                {t(locale, weekdayKey(columnIndex))}
              </span>
              <span className="text-sm font-semibold tabular-nums leading-tight">
                {calendarDayNumber(date)}
              </span>
            </div>
          );
        })}

        {slotStarts.map((start) => {
          const isHour = start.endsWith(":00");
          return (
            <Fragment key={start}>
              <div
                className={`sticky left-0 z-10 flex h-7 items-center justify-end border-b border-r border-white/10 bg-[var(--tg-theme-bg-color,#0f172a)] pr-1 text-[10px] font-semibold tabular-nums leading-none ${
                  isHour ? "opacity-80" : "opacity-45"
                }`}
              >
                {start}
              </div>
              {weekDays.map((date, columnIndex) => {
                const state = statesByDate.get(date)?.get(start) ?? "free";
                const isToday = date === todayIso;
                const label = `${t(locale, weekdayKey(columnIndex))} ${calendarDayNumber(date)}, ${start}, ${t(locale, stateKey(state))}`;
                const interactive =
                  (state === "free" && addonActive) || state === "mine" || state === "mine_hold";
                const className = `h-7 w-full border-b border-r border-white/10 ${cellClass(state, isToday)} ${
                  isHour ? "border-b-white/20" : ""
                }`;
                if (!interactive) {
                  return (
                    <div
                      key={`${date}-${start}`}
                      className={`${className} opacity-70`}
                      aria-label={label}
                    />
                  );
                }
                return (
                  <button
                    key={`${date}-${start}`}
                    type="button"
                    aria-label={label}
                    className={`${className} p-0 cursor-pointer`}
                    onClick={() => onCell(date, start, state)}
                  />
                );
              })}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
