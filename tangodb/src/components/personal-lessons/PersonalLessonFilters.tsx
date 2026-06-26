import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo } from "react";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules, shouldShowDisciplinePicker, shouldShowLocationPicker } from "../../lib/orgModules";
import { addDays, formatWeekRangeLabel, getWeekRange, toISODateLocal } from "../../lib/scheduleWeek";
import { currentYearMonth, formatMonthTitle, shiftMonth } from "../../lib/utils";
import type { Discipline } from "../../types";
import { memberListLabel, type TeamMemberRow } from "../../hooks/useTeamMembers";
import { useI18n } from "../../hooks/useI18n";
import AppSelect from "../ui/AppSelect";
import DatePickerField from "../ui/DatePickerField";
import type {
  PersonalLessonFilterState,
  PersonalLessonPeriodMode,
} from "./personalLessonFilterUtils";

interface LocationOption {
  id: string;
  name: string;
}

interface PersonalLessonFiltersProps {
  filters: PersonalLessonFilterState;
  onChange: (patch: Partial<PersonalLessonFilterState>) => void;
  locations: LocationOption[];
  disciplines: Discipline[];
  teachers: TeamMemberRow[];
}

export default function PersonalLessonFilters({
  filters,
  onChange,
  locations,
  disciplines,
  teachers,
}: PersonalLessonFiltersProps) {
  const { t, locale } = useI18n();
  const { settings } = useOrganization();
  const orgModules = normalizeOrgModules(settings?.modules);
  const showLocationFilter = shouldShowLocationPicker(orgModules, locations.length);
  const showDisciplineFilter = shouldShowDisciplinePicker(orgModules, disciplines.length);

  const periodModes: { id: PersonalLessonPeriodMode; label: string }[] = [
    { id: "week", label: t("common.week") },
    { id: "month", label: t("common.month") },
    { id: "range", label: t("common.period") },
  ];

  const paidFilters = [
    { id: "all" as const, label: t("common.all") },
    { id: "yes" as const, label: t("common.paid") },
    { id: "no" as const, label: t("common.debt") },
  ];

  const isCurrentMonth = filters.yearMonth === currentYearMonth();
  const weekEndDate = addDays(filters.weekStart, 6);
  const weekLabel = formatWeekRangeLabel(
    new Date(`${filters.weekStart}T12:00:00`),
    new Date(`${weekEndDate}T12:00:00`)
  );
  const isCurrentWeek = useMemo(() => {
    const { weekStart: current } = getWeekRange(new Date());
    return filters.weekStart === toISODateLocal(current);
  }, [filters.weekStart]);

  const shiftWeek = (delta: number) => {
    const next = addDays(filters.weekStart, delta * 7);
    onChange({ weekStart: next });
  };

  const goToCurrentWeek = () => {
    const { weekStart } = getWeekRange(new Date());
    onChange({ weekStart: toISODateLocal(weekStart) });
  };

  return (
    <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap bg-slate-100 rounded-lg p-1 text-xs font-semibold gap-1">
          {periodModes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              onClick={() => onChange({ periodMode: mode.id })}
              className={`px-3 py-1.5 rounded-md cursor-pointer transition-all ${
                filters.periodMode === mode.id
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {filters.periodMode === "week" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => shiftWeek(-1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              aria-label={t("common.aria.prevWeek")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center gap-0.5 min-w-[120px] sm:min-w-[180px]">
              <span className="text-sm font-semibold text-slate-800 text-center">{weekLabel}</span>
              {!isCurrentWeek && (
                <button
                  type="button"
                  onClick={goToCurrentWeek}
                  className="text-[10px] font-semibold text-indigo-600 hover:underline cursor-pointer"
                >
                  {t("common.currentWeek")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => shiftWeek(1)}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              aria-label={t("common.aria.nextWeek")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {filters.periodMode === "month" && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onChange({ yearMonth: shiftMonth(filters.yearMonth, -1) })}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="flex flex-col items-center gap-0.5 min-w-[120px]">
              <span className="text-sm font-semibold text-slate-800">
                {formatMonthTitle(filters.yearMonth, locale)}
              </span>
              {!isCurrentMonth && (
                <button
                  type="button"
                  onClick={() => onChange({ yearMonth: currentYearMonth() })}
                  className="text-[10px] font-semibold text-indigo-600 hover:underline cursor-pointer"
                >
                  {t("common.currentMonth")}
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={() => onChange({ yearMonth: shiftMonth(filters.yearMonth, 1) })}
              className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 cursor-pointer"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {filters.periodMode === "range" && (
          <div className="flex flex-wrap items-end gap-2">
            <DatePickerField
              label={t("common.dateFrom")}
              value={filters.rangeStart}
              onChange={(v) => onChange({ rangeStart: v })}
            />
            <DatePickerField
              label={t("common.dateTo")}
              value={filters.rangeEnd}
              onChange={(v) => onChange({ rangeEnd: v })}
            />
          </div>
        )}

        <div className="flex flex-wrap bg-slate-100 rounded-lg p-1 text-xs font-semibold gap-1 ml-auto">
          {paidFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onChange({ paidFilter: item.id })}
              className={`px-3 py-1.5 rounded-md cursor-pointer transition-all ${
                filters.paidFilter === item.id
                  ? "bg-white text-slate-900 shadow-xs font-semibold"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {showLocationFilter && (
        <AppSelect
          label={t("schedule.form.location")}
          value={filters.locationId}
          onChange={(e) => onChange({ locationId: e.target.value })}
        >
          <option value="">{t("common.allLocations")}</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </AppSelect>
        )}

        {showDisciplineFilter && (
        <AppSelect
          label={t("common.discipline")}
          value={filters.disciplineId}
          onChange={(e) => onChange({ disciplineId: e.target.value })}
        >
          <option value="">{t("common.allDisciplines")}</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </AppSelect>
        )}

        <AppSelect
          label={t("schedule.form.teacher")}
          value={filters.teacherMemberId}
          onChange={(e) => onChange({ teacherMemberId: e.target.value })}
        >
          <option value="">{t("common.allTeachers")}</option>
          {teachers.map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {memberListLabel(teacher)}
            </option>
          ))}
        </AppSelect>

        <div className="relative">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block mb-1">
            {t("common.searchClient")}
          </label>
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-[calc(50%+6px)] -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            placeholder={t("common.searchByName")}
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg text-xs transition-all"
          />
        </div>
      </div>
    </div>
  );
}
