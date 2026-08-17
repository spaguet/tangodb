import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getDowLabels, jsDayToIsoDow } from "../../lib/utils";
import { getWeekRange, toISODateLocal } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";

interface WeekPickerPopoverProps {
  selectedWeekStart: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
}

function buildMonthGrid(viewMonth: Date): (Date | null)[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = jsDayToIsoDow(firstDay.getDay()) - 1;

  const cells: (Date | null)[] = Array.from({ length: startOffset }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(new Date(year, month, d));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function isInSelectedWeek(day: Date, weekStart: Date, weekEnd: Date): boolean {
  const t = day.getTime();
  return t >= weekStart.getTime() && t <= weekEnd.getTime();
}

export default function WeekPickerPopover({
  selectedWeekStart,
  onSelect,
}: WeekPickerPopoverProps) {
  const { t, locale, formatDate } = useI18n();
  const [viewMonth, setViewMonth] = useState(
    () => new Date(selectedWeekStart.getFullYear(), selectedWeekStart.getMonth(), 1)
  );

  const weekdayHeaders = useMemo(() => {
    const labels = getDowLabels(locale);
    return [1, 2, 3, 4, 5, 6, 7].map((dow) => labels[dow]);
  }, [locale]);

  const { weekEnd } = useMemo(
    () => getWeekRange(selectedWeekStart),
    [selectedWeekStart]
  );
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const monthLabel = formatDate(viewMonth, { month: "long", year: "numeric" });
  const cells = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);

  const shiftMonth = (delta: number) => {
    setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  };

  return (
    <div className="absolute left-0 sm:left-auto sm:right-0 top-full mt-1 z-50 w-72 rounded-xl border border-ink-200 bg-white shadow-lg p-3">
      <div className="flex items-center justify-between mb-3">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          aria-label={t("subscriptions.aria.prevMonth")}
          className="p-1.5 text-ink-400 hover:text-gold-800 hover:bg-gold-50 rounded-lg transition-all cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-xs font-semibold text-ink-800 capitalize">{monthLabel}</span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          aria-label={t("subscriptions.aria.nextMonth")}
          className="p-1.5 text-ink-400 hover:text-gold-800 hover:bg-gold-50 rounded-lg transition-all cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {weekdayHeaders.map((d) => (
          <div
            key={d}
            className="text-center text-[10px] font-semibold uppercase tracking-wider text-ink-500 py-1"
          >
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">
        {cells.map((day, idx) => {
          if (!day) {
            return <div key={`empty-${idx}`} className="h-8" />;
          }

          const inWeek = isInSelectedWeek(day, selectedWeekStart, weekEnd);
          const isToday = isSameDay(day, today);

          return (
            <button
              key={toISODateLocal(day)}
              type="button"
              onClick={() => onSelect(day)}
              className={`h-8 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                inWeek
                  ? "bg-gold-700 text-white hover:bg-gold-800"
                  : isToday
                    ? "bg-gold-50 text-gold-700 hover:bg-gold-100"
                    : "text-ink-700 hover:bg-ink-100"
              }`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}
