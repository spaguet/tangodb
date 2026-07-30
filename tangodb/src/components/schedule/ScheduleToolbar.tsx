import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, CalendarOff, CalendarPlus, Building2 } from "lucide-react";
import { getWeekRange, formatWeekRangeLabel, toISODateLocal } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import AppSelect from "../ui/AppSelect";
import WeekPickerPopover from "./WeekPickerPopover";

export interface TeacherFilterOption {
  id: string;
  label: string;
}

interface ScheduleToolbarProps {
  weekStart: Date;
  onWeekChange: (weekStart: Date) => void;
  teacherFilter: string;
  onTeacherFilterChange: (teacherId: string) => void;
  teacherFilterOptions: TeacherFilterOption[];
  canManageTeacherVacation?: boolean;
  onTeacherVacationClick?: () => void;
  canManageCalendarEvents?: boolean;
  onCreateEventClick?: () => void;
  canManageRentals?: boolean;
  onCreateRentalClick?: () => void;
}

export default function ScheduleToolbar({
  weekStart,
  onWeekChange,
  teacherFilter,
  onTeacherFilterChange,
  teacherFilterOptions,
  canManageTeacherVacation = false,
  onTeacherVacationClick,
  canManageCalendarEvents = false,
  onCreateEventClick,
  canManageRentals = false,
  onCreateRentalClick,
}: ScheduleToolbarProps) {
  const { t, locale } = useI18n();
  const [pickerOpen, setPickerOpen] = useState(false);
  const { weekEnd } = useMemo(() => getWeekRange(weekStart), [weekStart]);
  const label = formatWeekRangeLabel(weekStart, weekEnd, locale);
  const isCurrentWeek = useMemo(() => {
    const { weekStart: current } = getWeekRange(new Date());
    return toISODateLocal(weekStart) === toISODateLocal(current);
  }, [weekStart]);

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
    <div className="flex flex-wrap items-end gap-2 sm:gap-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          aria-label={t("common.aria.prevWeek")}
          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center gap-0.5 min-w-[140px] sm:min-w-[200px] px-3 py-1">
          <span className="text-sm font-semibold text-slate-800 text-center">{label}</span>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={goToCurrentWeek}
              className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
            >
              {t("common.currentWeek")}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => shiftWeek(1)}
          aria-label={t("common.aria.nextWeek")}
          className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-label={t("common.aria.pickWeek")}
            aria-expanded={pickerOpen}
            className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
          >
            <CalendarDays className="w-4 h-4" />
          </button>

          {pickerOpen && (
            <>
              <button
                type="button"
                aria-label={t("common.aria.closeCalendar")}
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

      {teacherFilterOptions.length > 0 && (
        <AppSelect
          label={t("schedule.form.teacher")}
          value={teacherFilter}
          onChange={(e) => onTeacherFilterChange(e.target.value)}
          className="min-w-[160px] sm:min-w-[200px]"
        >
          <option value="">{t("common.allTeachers")}</option>
          {teacherFilterOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </AppSelect>
      )}

      {canManageCalendarEvents && onCreateEventClick ? (
        <button
          type="button"
          onClick={onCreateEventClick}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-sans font-semibold uppercase tracking-wider text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-colors cursor-pointer"
        >
          <CalendarPlus className="w-3.5 h-3.5" />
          {t("schedule.event.action")}
        </button>
      ) : null}

      {canManageRentals && onCreateRentalClick ? (
        <button
          type="button"
          onClick={onCreateRentalClick}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-sans font-semibold uppercase tracking-wider text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors cursor-pointer"
        >
          <Building2 className="w-3.5 h-3.5" />
          {t("schedule.rental.action")}
        </button>
      ) : null}

      {canManageTeacherVacation && onTeacherVacationClick ? (
        <button
          type="button"
          onClick={onTeacherVacationClick}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-[10px] font-sans font-semibold uppercase tracking-wider text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg transition-colors cursor-pointer"
        >
          <CalendarOff className="w-3.5 h-3.5" />
          {t("schedule.vacation.action")}
        </button>
      ) : null}
    </div>
  );
}
