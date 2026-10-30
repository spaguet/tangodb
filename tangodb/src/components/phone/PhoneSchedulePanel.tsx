import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "../../hooks/useI18n";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useOfflineShiftMeta } from "../../hooks/useOfflineShift";
import { useAccessibleLocations } from "../../hooks/useLocations";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useLessonSubstitutes } from "../../hooks/useLessonSubstitutes";
import { usePersonalLessons } from "../../hooks/usePersonalLessons";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useUIStore } from "../../store/ui";
import { usePersonalLessonsModuleEnabled } from "../../hooks/useOrgModules";
import {
  applySubstitutesToGroupLessons,
  applySubstitutesToPersonalRecords,
} from "../../lib/lessonSubstitute";
import { scheduleDatesFromSnapshot } from "../../lib/offline/buildSnapshot";
import {
  canViewGroupAttendanceLesson,
  canViewPersonalAttendanceLesson,
} from "../../lib/teacherAttendanceAccess";
import { computeScheduleDatesForMonth, useScheduleDates } from "../../hooks/useAttendance";
import { useSchedule } from "../../hooks/useSchedule";
import {
  scheduleLocationDisplayName,
  shouldHideEmptyDraftLocation,
} from "../../lib/locationDisplay";
import { formatMonthTitle, getDowLabels, jsDayToIsoDow, shiftMonth } from "../../lib/utils";
import OfflineLimitedState from "../offline/OfflineLimitedState";
import OfflineScopeNotice from "../offline/OfflineScopeNotice";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import AddLocationsInSettingsHint from "../ui/AddLocationsInSettingsHint";

function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type DayLessonRow = {
  key: string;
  kind: "group" | "personal";
  start: string;
  label: string;
};

export default function PhoneSchedulePanel() {
  const { t, locale, formatDate } = useI18n();
  const navigate = useNavigate();
  const { connectionState } = useOnlineStatus();
  const { isOfflineMode, snapshot, snapshotMeta } = useOfflineShiftMeta(connectionState);
  const offlineBlocked =
    isOfflineMode && (!snapshotMeta.hasSnapshot || snapshotMeta.isExpired);

  const selectedMonth = useUIStore((s) => s.selectedMonth);
  const setSelectedMonth = useUIStore((s) => s.setSelectedMonth);
  const {
    locations,
    isLoading: locationsLoading,
    isError: locationsError,
    error: locationsErr,
  } = useAccessibleLocations();
  const scheduleListQuery = useSchedule();
  const { data: disciplines = [] } = useDisciplines();
  const disciplineMap = useMemo(
    () => new Map(disciplines.map((d) => [d.id, d.name])),
    [disciplines]
  );
  const draftLocationBadge = t("schedule.location.draftBadge");
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) ?? null;
  const [selectedDate, setSelectedDate] = useState(todayDateStr);

  const {
    dates: monthScheduleDates = [],
    isLoading: scheduleLoading,
    isError: scheduleError,
    error: scheduleErr,
  } = useScheduleDates(selectedLocationId ? selectedMonth : undefined, selectedLocationId);

  const effectiveMonthScheduleDates = useMemo(() => {
    if (!isOfflineMode || !snapshot) return monthScheduleDates;
    return scheduleDatesFromSnapshot(snapshot, selectedLocationId, selectedMonth).map((e) => ({
      date: e.date,
      time: e.time,
      timeEnd: e.timeEnd ?? e.time,
      slotId: e.slotId,
      disciplineId: e.disciplineId ?? null,
      locationId: e.locationId ?? null,
      scheduleGroupId: e.scheduleGroupId ?? null,
      teacherMemberId: e.teacherMemberId ?? null,
      substituteTeacherMemberId: null as string | null,
      groupName: e.label,
    }));
  }, [monthScheduleDates, isOfflineMode, snapshot, selectedLocationId, selectedMonth]);

  const { data: substituteRows = [] } = useLessonSubstitutes();
  const monthDatesWithSubstitutes = useMemo(
    () =>
      isOfflineMode
        ? effectiveMonthScheduleDates
        : applySubstitutesToGroupLessons(effectiveMonthScheduleDates, substituteRows),
    [effectiveMonthScheduleDates, substituteRows, isOfflineMode]
  );

  const {
    data: personalLessonsRaw = [],
    isLoading: personalLoading,
  } = usePersonalLessons({
    yearMonth: selectedLocationId ? selectedMonth : undefined,
    enabled: selectedLocationId != null && personalLessonsEnabled && !isOfflineMode,
  });
  const personalLessons = useMemo(
    () => applySubstitutesToPersonalRecords(personalLessonsRaw, substituteRows),
    [personalLessonsRaw, substituteRows]
  );

  const { role, memberId, scope, settings: orgSettings } = useOrganization();
  const attendanceAccessOptions = useMemo(
    () => ({ directorsCanMarkAttendance: orgSettings?.directors_can_mark_attendance ?? true }),
    [orgSettings?.directors_can_mark_attendance]
  );

  const lessonsPerLocation = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of computeScheduleDatesForMonth(
      scheduleListQuery.data ?? [],
      selectedMonth,
      undefined
    )) {
      const id = entry.locationId;
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [scheduleListQuery.data, selectedMonth]);

  const visibleLocations = useMemo(
    () =>
      locations.filter(
        (loc) => !shouldHideEmptyDraftLocation(loc, lessonsPerLocation.get(loc.id) ?? 0)
      ),
    [locations, lessonsPerLocation]
  );

  useEffect(() => {
    if (selectedLocationId != null || visibleLocations.length !== 1) return;
    setSelectedLocationId(visibleLocations[0].id);
  }, [visibleLocations, selectedLocationId]);

  useEffect(() => {
    const today = todayDateStr();
    const todayMonth = today.slice(0, 7);
    if (selectedMonth !== todayMonth) {
      setSelectedMonth(todayMonth);
    }
    setSelectedDate(today);
  }, []);

  useEffect(() => {
    if (selectedDate.slice(0, 7) !== selectedMonth) {
      setSelectedMonth(selectedDate.slice(0, 7));
    }
  }, [selectedDate, selectedMonth, setSelectedMonth]);

  const locationPersonalLessons = useMemo(
    () =>
      personalLessons.filter((lesson) => (lesson.locationId ?? null) === selectedLocationId),
    [personalLessons, selectedLocationId]
  );

  const accessibleMonthGroupDates = useMemo(
    () =>
      monthDatesWithSubstitutes.filter((slot) =>
        canViewGroupAttendanceLesson(
          role,
          memberId,
          scope,
          {
            scheduleGroupId: slot.scheduleGroupId,
            teacherMemberId: slot.teacherMemberId,
            substituteTeacherMemberId: slot.substituteTeacherMemberId,
          },
          attendanceAccessOptions
        )
      ),
    [monthDatesWithSubstitutes, role, memberId, scope, attendanceAccessOptions]
  );

  const accessiblePersonalForMonth = useMemo(
    () =>
      locationPersonalLessons.filter((lesson) =>
        canViewPersonalAttendanceLesson(role, memberId, lesson, attendanceAccessOptions)
      ),
    [locationPersonalLessons, role, memberId, attendanceAccessOptions]
  );

  const dayLessons = useMemo((): DayLessonRow[] => {
    const group = accessibleMonthGroupDates
      .filter((slot) => slot.date === selectedDate && slot.scheduleGroupId)
      .map((slot) => {
        const disciplineName = slot.disciplineId
          ? disciplineMap.get(slot.disciplineId)
          : undefined;
        const label = disciplineName
          ? `${disciplineName} · ${slot.time}`
          : slot.groupName
            ? `${slot.groupName} · ${slot.time}`
            : t("attendance.groupLessonTime", { time: slot.time, timeEnd: slot.timeEnd });
        return {
          key: `g-${slot.date}|${slot.time}|${slot.scheduleGroupId}`,
          kind: "group" as const,
          start: slot.time,
          label,
        };
      });

    const personal =
      isOfflineMode
        ? []
        : accessiblePersonalForMonth
            .filter((l) => l.date === selectedDate)
            .map((lesson) => ({
              key: `p-${lesson.id}`,
              kind: "personal" as const,
              start: lesson.timeStart,
              label: `${lesson.clientDisplay} · ${lesson.timeStart} – ${lesson.timeEnd}`,
            }));

    return [...group, ...personal].sort((a, b) => a.start.localeCompare(b.start));
  }, [
    accessibleMonthGroupDates,
    accessiblePersonalForMonth,
    selectedDate,
    disciplineMap,
    isOfflineMode,
    t,
  ]);

  const weekdayLabels = useMemo(() => {
    const labels = getDowLabels(locale);
    return [1, 2, 3, 4, 5, 6, 7].map((dow) => labels[dow]);
  }, [locale]);

  const formatScheduleDate = (dateStr: string): string => {
    const [y, m, d] = dateStr.split("-").map(Number);
    if (!y || !m || !d) return dateStr;
    const date = new Date(y, m - 1, d);
    const dowLabels = getDowLabels(locale);
    const monthDay = formatDate(date, { day: "numeric", month: "long" });
    const dow = dowLabels[jsDayToIsoDow(date.getDay())] ?? "";
    return `${monthDay} (${dow})`;
  };

  const calendarCells = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startDow = jsDayToIsoDow(firstDay.getDay());
    const groupDates = new Set(accessibleMonthGroupDates.map((e) => e.date));
    const personalDates = new Set(accessiblePersonalForMonth.map((l) => l.date));
    const cells: {
      date: string | null;
      day: number | null;
      hasGroup: boolean;
      hasPersonal: boolean;
      isToday: boolean;
    }[] = [];

    for (let i = 1; i < startDow; i++) {
      cells.push({ date: null, day: null, hasGroup: false, hasPersonal: false, isToday: false });
    }

    const today = todayDateStr();
    for (let day = 1; day <= daysInMonth; day++) {
      const dd = String(day).padStart(2, "0");
      const mm = String(month).padStart(2, "0");
      const date = `${year}-${mm}-${dd}`;
      cells.push({
        date,
        day,
        hasGroup: groupDates.has(date),
        hasPersonal: !isOfflineMode && personalDates.has(date),
        isToday: date === today,
      });
    }

    return cells;
  }, [selectedMonth, accessibleMonthGroupDates, accessiblePersonalForMonth, isOfflineMode]);

  const handleMonthNav = (delta: number) => {
    const nextMonth = shiftMonth(selectedMonth, delta);
    setSelectedMonth(nextMonth);
    const [y, m] = nextMonth.split("-").map(Number);
    const currentDay = parseInt(selectedDate.split("-")[2], 10);
    const daysInNext = new Date(y, m, 0).getDate();
    const day = Math.min(currentDay, daysInNext);
    setSelectedDate(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  };

  const isLoading = locationsLoading || (selectedLocationId != null && (scheduleLoading || personalLoading));
  const isError = locationsError || scheduleError;
  const error = locationsErr ?? scheduleErr;

  if (isError) {
    return (
      <div className="panel-page-stack">
        <QueryErrorState error={error} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (selectedLocationId && offlineBlocked) {
    return (
      <div className="panel-page-stack">
        <OfflineLimitedState
          reason={snapshotMeta.isExpired ? "expired" : "missing"}
          windowStart={snapshotMeta.windowStart}
          windowEnd={snapshotMeta.windowEnd}
          locations={snapshot?.locations}
        />
      </div>
    );
  }

  if (!selectedLocationId) {
    return (
      <div className="panel-page-stack">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
          <div className="panel-card-stack">
            <h2 className="text-base font-semibold tracking-tight text-slate-800">{t("nav.panel.schedule")}</h2>
            <p className="text-xs text-slate-400">{t("attendance.hint.selectLocation")}</p>
          </div>
          {isLoading ? (
            <LoadingState label={t("attendance.loadingLocations")} />
          ) : visibleLocations.length === 0 ? (
            <div className="py-8 text-center text-slate-400 space-y-2">
              <MapPin className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm text-slate-600 leading-relaxed px-2">{t("attendance.emptyJournal")}</p>
              <AddLocationsInSettingsHint className="text-xs text-slate-500 font-sans" />
            </div>
          ) : (
            <div className="space-y-2">
              {visibleLocations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setSelectedLocationId(loc.id)}
                  className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-all cursor-pointer text-left min-h-12 touch-manipulation"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {scheduleLocationDisplayName(loc, draftLocationBadge)}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="panel-page-stack">
        <LoadingState label={t("schedule.loading")} />
      </div>
    );
  }

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="panel-card-stack">
          <button
            type="button"
            onClick={() => setSelectedLocationId(null)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer min-h-12"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            {t("attendance.allLocations")}
          </button>
          <h2 className="text-base font-semibold tracking-tight text-slate-800">{t("nav.panel.schedule")}</h2>
          {selectedLocation ? (
            <p className="text-xs text-slate-500 font-sans flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              {scheduleLocationDisplayName(selectedLocation, draftLocationBadge)}
            </p>
          ) : null}
          {isOfflineMode && snapshotMeta.hasSnapshot && snapshotMeta.isStale ? (
            <p className="text-xs text-amber-700 font-semibold">{t("offline.snapshot.stale")}</p>
          ) : null}
          {isOfflineMode && snapshotMeta.windowStart && snapshotMeta.windowEnd ? (
            <p className="text-[11px] text-slate-400">
              {t("offline.snapshot.window", {
                start: snapshotMeta.windowStart,
                end: snapshotMeta.windowEnd,
              })}
            </p>
          ) : null}
        </div>

        {isOfflineMode && snapshotMeta.hasSnapshot && !snapshotMeta.isExpired ? (
          <OfflineScopeNotice />
        ) : null}

        <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
          <p className="text-xs font-semibold text-slate-700">{formatScheduleDate(selectedDate)}</p>
          <p className="text-[10px] text-slate-400 mt-0.5 font-sans">{t("attendance.daySchedule")}</p>
        </div>

        {dayLessons.length > 0 ? (
          <div className="space-y-2">
            {dayLessons.map((entry) => (
              <div
                key={entry.key}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-200 bg-white text-left min-h-12"
              >
                <div className="min-w-0">
                  <p
                    className={`text-[10px] font-sans font-semibold uppercase tracking-wider ${
                      entry.kind === "group" ? "text-indigo-600" : "text-indigo-700"
                    }`}
                  >
                    {entry.kind === "group" ? t("common.groupLabel") : t("common.personalLabel")}
                  </p>
                  <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{entry.label}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 font-sans text-center py-4">{t("attendance.noLessonsDay")}</p>
        )}

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-200">
            <button
              type="button"
              onClick={() => handleMonthNav(-1)}
              className="p-2.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer min-h-12 min-w-12 flex items-center justify-center touch-manipulation"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">
              {formatMonthTitle(selectedMonth, locale)}
            </span>
            <button
              type="button"
              onClick={() => handleMonthNav(1)}
              className="p-2.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer min-h-12 min-w-12 flex items-center justify-center touch-manipulation"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 bg-slate-50/50">
            {weekdayLabels.map((label) => (
              <div
                key={label}
                className="text-center text-[10px] font-sans font-semibold text-slate-400 uppercase py-2"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-px bg-slate-200 p-px">
            {calendarCells.map((cell, idx) => {
              if (!cell.date || cell.day === null) {
                return <div key={`empty-${idx}`} className="bg-white min-h-[52px]" />;
              }
              const isSelected = cell.date === selectedDate;
              return (
                <button
                  key={cell.date}
                  type="button"
                  onClick={() => setSelectedDate(cell.date!)}
                  className={`bg-white min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-xs font-semibold transition-colors cursor-pointer touch-manipulation ${
                    isSelected
                      ? "bg-indigo-600 text-white ring-2 ring-indigo-600 ring-inset"
                      : cell.isToday
                        ? "text-indigo-700 bg-indigo-50/80"
                        : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <span>{cell.day}</span>
                  {(cell.hasGroup || cell.hasPersonal) && !isSelected ? (
                    <span className="flex gap-0.5">
                      {cell.hasGroup ? (
                        <span className="w-1 h-1 rounded-full bg-indigo-500" />
                      ) : null}
                      {cell.hasPersonal ? (
                        <span className="w-1 h-1 rounded-full bg-violet-500" />
                      ) : null}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={() => navigate("/attendance")}
          className="w-full min-h-12 px-4 py-3 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 cursor-pointer touch-manipulation"
        >
          {t("phone.schedule.openJournal")}
        </button>
      </div>
    </div>
  );
}
