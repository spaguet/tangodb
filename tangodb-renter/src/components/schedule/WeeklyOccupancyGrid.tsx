import { useMemo } from "react";
import { occupancyBlockClass } from "../../lib/crmUi";
import { minutesToTime, slotStartOptions, timeToMinutes } from "../../lib/grid";
import {
  formatHourLabel,
  GRID_LAYOUT_SLOT_MINUTES,
  GRID_ROW_HEIGHT_PX,
  occupancyGridHeightPx,
  occupancyHeightPx,
  occupancyTopPx,
} from "../../lib/occupancyLayout";
import { calendarDayNumber, isFreeSlotBookable, orgLocalDate } from "../../lib/orgTime";
import {
  computeOccupancyDisplayRange,
  daySlotStates,
  findOverlappingMine,
  isOccupiedBlock,
  mergeSlotStates,
  type OccupiedBlock,
  type OccupancyBlock,
  type SlotState,
} from "../../lib/occupancyMerge";
import { computeServerOffsetMs, serverNowMs } from "../../lib/serverTime";
import type { MineSlot, OccupancyData } from "../../lib/types";
import { t, WEEKDAY_LABELS, type Locale, type MessageKey } from "../../i18n/strings";

type WeeklyOccupancyGridProps = {
  locale: Locale;
  timezone: string;
  serverNow: string;
  weekDays: string[];
  occupancy: OccupancyData;
  addonActive: boolean;
  onFreeCell: (date: string, start: string) => void;
  onMineCell: (slot: MineSlot) => void;
};

const HOLD_STRIPES =
  "repeating-linear-gradient(-45deg, transparent, transparent 5px, rgba(255,255,255,0.22) 5px, rgba(255,255,255,0.22) 9px)";

function stateKey(state: SlotState): MessageKey {
  if (state === "mine_hold") return "mineHold";
  if (state === "mine_debt") return "mineDebt";
  return state;
}

function weekdayKey(columnIndex: number): MessageKey {
  return WEEKDAY_LABELS[columnIndex + 1] ?? "mon";
}

function dayHeaderBgClass(isToday: boolean, isPastDay: boolean): string {
  if (isToday) return "bg-slate-200";
  if (isPastDay) return "bg-slate-100";
  return "bg-slate-50";
}

function dayColumnBgClass(isToday: boolean, isPastDay: boolean): string {
  if (isToday) return "bg-slate-100/80";
  if (isPastDay) return "bg-slate-100";
  return "bg-white";
}

function clipBlock(
  block: OccupancyBlock,
  rangeStartMin: number,
  rangeEndMin: number
): OccupancyBlock | null {
  const start = Math.max(timeToMinutes(block.timeStart), rangeStartMin);
  const end = Math.min(timeToMinutes(block.timeEnd), rangeEndMin);
  if (end <= start) return null;
  return { ...block, timeStart: minutesToTime(start), timeEnd: minutesToTime(end) };
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
  const nowMs = serverNowMs(computeServerOffsetMs(serverNow));
  const todayIso = orgLocalDate(timezone, new Date(nowMs));

  const statesByDate = useMemo(() => {
    const map = new Map<string, Map<string, SlotState>>();
    for (const date of weekDays) {
      map.set(date, daySlotStates(date, slotStarts, occupancy.busy, occupancy.mine));
    }
    return map;
  }, [weekDays, slotStarts, occupancy.busy, occupancy.mine]);

  const { start: rangeStartMin, end: rangeEndMin } = useMemo(() => {
    const weekSet = new Set(weekDays);
    const intervals = [
      ...occupancy.busy.filter((slot) => weekSet.has(slot.date)),
      ...occupancy.mine.filter((slot) => weekSet.has(slot.date)),
    ];
    return computeOccupancyDisplayRange(intervals);
  }, [weekDays, occupancy.busy, occupancy.mine]);

  const visibleStarts = useMemo(
    () => slotStarts.filter((start) => {
      const min = timeToMinutes(start);
      return min >= rangeStartMin && min < rangeEndMin;
    }),
    [slotStarts, rangeStartMin, rangeEndMin]
  );

  const gridHeight = occupancyGridHeightPx(rangeStartMin, rangeEndMin);
  const rowCount = (rangeEndMin - rangeStartMin) / GRID_LAYOUT_SLOT_MINUTES;

  const timeLabels = useMemo(() => {
    const labels: { top: number; label: string }[] = [];
    for (let min = rangeStartMin; min < rangeEndMin; min += 60) {
      labels.push({
        top: ((min - rangeStartMin) / GRID_LAYOUT_SLOT_MINUTES) * GRID_ROW_HEIGHT_PX,
        label: formatHourLabel(min),
      });
    }
    return labels;
  }, [rangeStartMin, rangeEndMin]);

  const hourLines = useMemo(() => {
    const lines: number[] = [];
    for (let min = rangeStartMin; min < rangeEndMin; min += 60) {
      if (min > rangeStartMin) {
        lines.push(((min - rangeStartMin) / GRID_LAYOUT_SLOT_MINUTES) * GRID_ROW_HEIGHT_PX);
      }
    }
    return lines;
  }, [rangeStartMin, rangeEndMin]);

  const onCell = (date: string, start: string, state: SlotState) => {
    if (state === "mine" || state === "mine_hold" || state === "mine_debt") {
      const rental = findOverlappingMine(date, start, occupancy.mine);
      if (rental) onMineCell(rental);
      return;
    }
    if (state === "free" && addonActive && isFreeSlotBookable(timezone, date, start, nowMs)) {
      onFreeCell(date, start);
    }
  };

  return (
    <div className="flex min-w-[640px] bg-white">
      <div className="sticky left-0 z-20 w-10 shrink-0 border-r border-slate-100 bg-white shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)] sm:w-12">
        <div
          className="sticky top-0 z-30 h-9 border-b border-slate-100 bg-slate-50/95 backdrop-blur-[2px] sm:h-11"
          aria-hidden
        />
        <div className="relative" style={{ height: gridHeight }}>
          {Array.from({ length: rowCount }, (_, i) => (
            <div
              key={i}
              className="absolute right-0 left-0 border-b border-slate-50"
              style={{ top: i * GRID_ROW_HEIGHT_PX, height: GRID_ROW_HEIGHT_PX }}
            />
          ))}
          {timeLabels.map(({ top, label }) => (
            <div
              key={label}
              className="absolute right-0.5 z-10 -translate-y-full bg-white pl-0.5 text-[10px] leading-none font-semibold text-slate-400 tabular-nums sm:right-1"
              style={{ top }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1">
        {weekDays.map((date, columnIndex) => {
          const isToday = date === todayIso;
          const isPastDay = date < todayIso;
          const states = statesByDate.get(date) ?? new Map<string, SlotState>();
          const occupied = mergeSlotStates(visibleStarts, states)
            .filter(isOccupiedBlock)
            .map((block) => clipBlock(block, rangeStartMin, rangeEndMin))
            .filter((block): block is OccupiedBlock => block != null && isOccupiedBlock(block));

          return (
            <div
              key={date}
              data-past-day={isPastDay ? "true" : undefined}
              className="min-w-0 flex-1 border-l border-slate-100 first:border-l-0"
            >
              <div
                className={`sticky top-0 z-30 flex h-9 flex-col items-center justify-center border-b border-slate-100 px-0.5 shadow-[0_2px_4px_-2px_rgba(15,23,42,0.08)] backdrop-blur-[2px] sm:h-11 sm:px-1 ${dayHeaderBgClass(isToday, isPastDay)}`}
              >
                <span
                  className={`text-[10px] leading-none font-semibold tracking-wider uppercase ${
                    isPastDay ? "text-slate-400/80" : "text-slate-400"
                  }`}
                >
                  {t(locale, weekdayKey(columnIndex))}
                </span>
                <span
                  className={`text-xs leading-tight font-semibold tabular-nums sm:text-sm ${
                    isPastDay ? "text-slate-500" : "text-slate-800"
                  }`}
                >
                  {calendarDayNumber(date)}
                </span>
              </div>

              <div
                className={`relative ${dayColumnBgClass(isToday, isPastDay)}`}
                style={{ height: gridHeight }}
              >
                {Array.from({ length: rowCount }, (_, i) => (
                  <div
                    key={i}
                    className={`absolute right-0 left-0 border-b border-slate-50 ${
                      i % 4 === 0 ? "border-slate-100" : ""
                    }`}
                    style={{ top: i * GRID_ROW_HEIGHT_PX, height: GRID_ROW_HEIGHT_PX }}
                  />
                ))}

                {hourLines.map((top) => (
                  <div
                    key={top}
                    className="pointer-events-none absolute right-0 left-0 border-t border-slate-200"
                    style={{ top }}
                  />
                ))}

                {visibleStarts.map((start) => {
                  const state = states.get(start) ?? "free";
                  if (state !== "free") return null;
                  const bookable =
                    addonActive && isFreeSlotBookable(timezone, date, start, nowMs);
                  if (!bookable) return null;
                  const label = `${t(locale, weekdayKey(columnIndex))} ${calendarDayNumber(date)}, ${start}, ${t(locale, "free")}`;
                  return (
                    <button
                      key={`${date}-${start}`}
                      type="button"
                      aria-label={label}
                      className="absolute right-0 left-0 z-0 cursor-pointer border-0 bg-transparent p-0 transition-colors hover:bg-indigo-50/60"
                      style={{
                        top: occupancyTopPx(start, rangeStartMin),
                        height: occupancyHeightPx(start, minutesToTime(timeToMinutes(start) + 30)),
                      }}
                      onClick={() => onCell(date, start, "free")}
                    />
                  );
                })}

                {occupied.map((block) => {
                  const ownSlot =
                    block.state === "mine" ||
                    block.state === "mine_hold" ||
                    block.state === "mine_debt";
                  const title = t(locale, stateKey(block.state));
                  const subtitle = `${block.timeStart.slice(0, 5)}–${block.timeEnd.slice(0, 5)}`;
                  const heightPx = occupancyHeightPx(block.timeStart, block.timeEnd);
                  const showSubtitle = heightPx >= GRID_ROW_HEIGHT_PX * 2;
                  const label = `${t(locale, weekdayKey(columnIndex))} ${calendarDayNumber(date)}, ${subtitle}, ${title}`;
                  const className = `${occupancyBlockClass(block.state)} ${
                    ownSlot ? "cursor-pointer hover:brightness-95" : ""
                  } ${isPastDay && !ownSlot ? "opacity-50 grayscale" : ""}`;

                  if (!ownSlot) {
                    return (
                      <div
                        key={`${date}-${block.timeStart}-${block.state}`}
                        className={className}
                        style={{
                          top: occupancyTopPx(block.timeStart, rangeStartMin),
                          height: heightPx,
                          left: 0,
                          width: "100%",
                          zIndex: 1,
                        }}
                        aria-label={label}
                        title={`${title} · ${subtitle}`}
                      >
                        <span className="block truncate">{title}</span>
                        {showSubtitle ? (
                          <span className="block truncate font-normal opacity-80">{subtitle}</span>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <button
                      key={`${date}-${block.timeStart}-${block.state}`}
                      type="button"
                      aria-label={label}
                      title={`${title} · ${subtitle}`}
                      className={`${className} p-0 text-left`}
                      style={{
                        top: occupancyTopPx(block.timeStart, rangeStartMin),
                        height: heightPx,
                        left: 0,
                        width: "100%",
                        zIndex: 2,
                        backgroundImage: block.state === "mine_hold" ? HOLD_STRIPES : undefined,
                      }}
                      onClick={() => onCell(date, block.timeStart, block.state)}
                    >
                      <span className="block truncate">{title}</span>
                      {showSubtitle ? (
                        <span className="block truncate font-normal opacity-80">{subtitle}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
