import { Fragment, useMemo } from "react";
import { occupancyCellClass } from "../../lib/crmUi";
import { slotStartOptions } from "../../lib/grid";
import { calendarDayNumber, isFreeSlotBookable, orgLocalDate } from "../../lib/orgTime";
import {
  daySlotStates,
  findOverlappingMine,
  type SlotState,
} from "../../lib/occupancyMerge";
import { serverNowMs, computeServerOffsetMs } from "../../lib/serverTime";
import type { OccupancyData } from "../../lib/types";
import { t, WEEKDAY_LABELS, type Locale, type MessageKey } from "../../i18n/strings";

type WeeklyOccupancyGridProps = {
  locale: Locale;
  timezone: string;
  serverNow: string;
  weekDays: string[];
  occupancy: OccupancyData;
  addonActive: boolean;
  onFreeCell: (date: string, start: string) => void;
  onMineCell: (rentalId: string) => void;
};

function stateKey(state: SlotState): MessageKey {
  if (state === "mine_hold") return "mineHold";
  if (state === "mine_debt") return "mineDebt";
  return state;
}

function weekdayKey(columnIndex: number): MessageKey {
  return WEEKDAY_LABELS[columnIndex + 1] ?? "mon";
}

export default function WeeklyOccupancyGrid({
  locale,
  timezone,
  serverNow,
  weekDays,
  occupancy,
  addonActive,
  onFreeCell,
  onMineCell,
}: WeeklyOccupancyGridProps) {
  const slotStarts = useMemo(() => slotStartOptions(), []);
  const todayIso = orgLocalDate(timezone);
  const nowMs = serverNowMs(computeServerOffsetMs(serverNow));

  const statesByDate = useMemo(() => {
    const map = new Map<string, Map<string, SlotState>>();
    for (const date of weekDays) {
      map.set(date, daySlotStates(date, slotStarts, occupancy.busy, occupancy.mine));
    }
    return map;
  }, [weekDays, slotStarts, occupancy.busy, occupancy.mine]);

  const onCell = (date: string, start: string, state: SlotState) => {
    if (state === "mine" || state === "mine_hold" || state === "mine_debt") {
      const rental = findOverlappingMine(date, start, occupancy.mine);
      if (rental) onMineCell(rental.id);
      return;
    }
    if (state === "free" && addonActive && isFreeSlotBookable(timezone, date, start, nowMs)) {
      onFreeCell(date, start);
    }
  };

  return (
    <div className="h-full min-h-0 overflow-auto bg-white [-webkit-overflow-scrolling:touch]">
      <div
        className="grid min-w-[640px]"
        style={{
          gridTemplateColumns: `2.5rem repeat(${weekDays.length}, minmax(4.25rem, 1fr))`,
        }}
      >
        <div
          className="sticky top-0 left-0 z-30 h-11 border-b border-r border-slate-100 bg-slate-50/95 backdrop-blur-[2px]"
          aria-hidden
        />
        {weekDays.map((date, columnIndex) => {
          const isToday = date === todayIso;
          return (
            <div
              key={`h-${date}`}
              className={`sticky top-0 z-20 flex h-11 flex-col items-center justify-center border-b border-r border-slate-100 backdrop-blur-[2px] shadow-[0_2px_4px_-2px_rgba(15,23,42,0.08)] ${
                isToday ? "bg-slate-200/70" : "bg-slate-50/95"
              }`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 leading-none">
                {t(locale, weekdayKey(columnIndex))}
              </span>
              <span className="text-sm font-semibold tabular-nums text-slate-800 leading-tight">
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
                className={`sticky left-0 z-10 flex h-7 items-center justify-end border-b border-r border-slate-100 bg-white pr-1 text-[10px] font-semibold tabular-nums text-slate-400 leading-none ${
                  isHour ? "" : "opacity-70"
                }`}
              >
                {start}
              </div>
              {weekDays.map((date, columnIndex) => {
                const state = statesByDate.get(date)?.get(start) ?? "free";
                const isToday = date === todayIso;
                const label = `${t(locale, weekdayKey(columnIndex))} ${calendarDayNumber(date)}, ${start}, ${t(locale, stateKey(state))}`;
                const ownSlot =
                  state === "mine" || state === "mine_hold" || state === "mine_debt";
                const bookableFree =
                  state === "free" &&
                  addonActive &&
                  isFreeSlotBookable(timezone, date, start, nowMs);
                const interactive = ownSlot || bookableFree;
                const borderCls = isHour ? "border-b-slate-100" : "border-b-slate-50";
                const className = `h-7 w-full border-b border-r border-slate-100 ${borderCls} ${occupancyCellClass(state, isToday)}`;
                if (!interactive) {
                  return (
                    <div
                      key={`${date}-${start}`}
                      className={`${className} opacity-50`}
                      aria-label={label}
                    />
                  );
                }
                return (
                  <button
                    key={`${date}-${start}`}
                    type="button"
                    aria-label={label}
                    className={`${className} p-0 cursor-pointer transition-colors`}
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
