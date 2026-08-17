import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays, CalendarOff, CalendarPlus, Building2 } from "lucide-react";
import { getWeekRange, formatWeekRangeLabel, toISODateLocal } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import { btnOpenCls } from "../ui/buttonStyles";
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
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          aria-label={t("common.aria.prevWeek")}
          className="p-1.5 rounded-lg hover:bg-ink-100 text-ink-500 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex flex-col items-center gap-0.5 min-w-[120px] sm:min-w-[180px]">
          <span className="text-sm font-semibold text-ink-800 text-center">{label}</span>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={goToCurrentWeek}
              className="text-[10px] font-semibold text-gold-700 hover:underline cursor-pointer"
            >
              {t("common.currentWeek")}
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => shiftWeek(1)}
          aria-label={t("common.aria.nextWeek")}
          className="p-1.5 rounded-lg hover:bg-ink-100 text-ink-500 cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-label={t("common.aria.pickWeek")}
            aria-expanded={pickerOpen}
            className="p-1.5 rounded-lg hover:bg-ink-100 text-ink-500 cursor-pointer"
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
          className={btnOpenCls}
        >
          <CalendarPlus className="w-4 h-4" />
          {t("schedule.event.action")}
        </button>
      ) : null}

      {canManageRentals && onCreateRentalClick ? (
        <button
          type="button"
          onClick={onCreateRentalClick}
          className={btnOpenCls}
        >
          <Building2 className="w-4 h-4" />
          {t("schedule.rental.action")}
        </button>
      ) : null}

      {canManageTeacherVacation && onTeacherVacationClick ? (
        <button
          type="button"
          onClick={onTeacherVacationClick}
          className={btnOpenCls}
        >
          <CalendarOff className="w-4 h-4" />
          {t("schedule.vacation.action")}
        </button>
      ) : null}
    </div>
  );
}
