import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { getWeekRange, toISODateLocal, formatWeekRangeLabel } from "../../lib/scheduleWeek";
import WeekPickerPopover from "./WeekPickerPopover";

interface ScheduleToolbarProps {
  weekStart: Date;
  onWeekChange: (weekStart: Date) => void;
}

export default function ScheduleToolbar({ weekStart, onWeekChange }: ScheduleToolbarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { weekEnd } = useMemo(() => getWeekRange(weekStart), [weekStart]);
  const label = formatWeekRangeLabel(weekStart, weekEnd);

  const shiftWeek = (delta: number) => {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + delta * 7);
    onWeekChange(next);
  };

  const goToCurrentWeek = () => {
    const { weekStart: current } = getWeekRange(new Date());
    onWeekChange(current);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          aria-label="Предыдущая неделя"
          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={goToCurrentWeek}
          className="min-w-[140px] sm:min-w-[200px] px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 rounded-lg transition-colors cursor-pointer text-center"
        >
          {label}
        </button>

        <button
          type="button"
          onClick={() => shiftWeek(1)}
          aria-label="Следующая неделя"
          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Выбрать неделю"
          aria-expanded={pickerOpen}
          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
        >
          <CalendarDays className="w-4 h-4" />
        </button>

        {pickerOpen && (
          <>
            <button
              type="button"
              aria-label="Закрыть календарь"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setPickerOpen(false)}
            />
            <WeekPickerPopover
              selectedWeekStart={weekStart}
              onSelect={(date) => {
                const { weekStart: ws } = getWeekRange(date);
                onWeekChange(ws);
                setPickerOpen(false);
              }}
              onClose={() => setPickerOpen(false)}
            />
          </>
        )}
      </div>
    </div>
  );
}
