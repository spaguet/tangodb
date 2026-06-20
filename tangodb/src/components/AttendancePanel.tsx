import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  X,
  Snowflake,
  Loader2,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Ticket,
  MapPin,
  ArrowLeft,
} from "lucide-react";
import {
  attendanceQueryKey,
  useMarkAttendance,
  useScheduleDates,
  useSubsForDate,
} from "../hooks/useAttendance";
import { usePersonalLessons, useMarkPersonalLessonAttendance, personalLessonsQueryKey } from "../hooks/usePersonalLessons";
import {
  getConnectionBlockReason,
  getMutationBlockedMessage,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { usePermissions } from "../hooks/usePermissions";
import { useSettings } from "../settings/SettingsProvider";
import {
  canApplyFreeze,
  freezeAlreadyUsedMessage,
  freezeUnavailableMessage,
} from "../lib/freezePolicy";
import { usePrices } from "../hooks/usePrices";
import { useAccessibleLocations } from "../hooks/useLocations";
import {
  dowShort,
  formatCurrency,
  formatDayMonthRu,
  formatMonthTitleRu,
  getSubscriptionTariffLabel,
  jsDayToIsoDow,
  pluralizeRu,
} from "../lib/utils";
import { useUIStore } from "../store/ui";
import QueryErrorState from "./ui/QueryErrorState";
import LoadingState from "./ui/LoadingState";
import VirtualList from "./ui/VirtualList";
import type { ToastType } from "../App";
import type { PersonalLesson, SubForDate } from "../types";

interface AttendancePanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

type DayLessonEntry =
  | {
      kind: "group";
      key: string;
      start: string;
      time: string;
      timeEnd: string;
      label: string;
      disciplineId?: string | null;
    }
  | { kind: "personal"; key: string; start: string; lesson: PersonalLesson; label: string };

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isDateMarkable(dateStr: string): boolean {
  return dateStr <= todayDateStr();
}

function formatAttendanceDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  const month = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(date);
  return `${d} ${month} (${dowShort(jsDayToIsoDow(date.getDay()))})`;
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function AttendancePanel({ toast }: AttendancePanelProps) {
  const queryClient = useQueryClient();
  const { connectionState } = useOnlineStatus();
  const selectedMonth = useUIStore((s) => s.selectedMonth);
  const setSelectedMonth = useUIStore((s) => s.setSelectedMonth);
  const {
    locations,
    isLoading: locationsLoading,
    isError: locationsError,
    error: locationsErr,
  } = useAccessibleLocations();

  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const selectedLocation = locations.find((loc) => loc.id === selectedLocationId) ?? null;

  const {
    dates: monthScheduleDates = [],
    isLoading: scheduleLoading,
    isError: scheduleError,
    error: scheduleErr,
  } = useScheduleDates(selectedLocationId ? selectedMonth : undefined, selectedLocationId);
  const {
    data: personalLessons = [],
    isLoading: personalLoading,
    isError: personalError,
    error: personalErr,
  } = usePersonalLessons(selectedLocationId ? selectedMonth : undefined, {
    enabled: selectedLocationId != null,
  });
  const { data: prices = [], isLoading: pricesLoading, isError: pricesError, error: pricesErr } = usePrices();

  const [selectedDate, setSelectedDate] = useState(todayDateStr);
  const [selectedLesson, setSelectedLesson] = useState<DayLessonEntry | null>(null);

  useEffect(() => {
    if (selectedLocationId != null || locations.length !== 1) return;
    setSelectedLocationId(locations[0].id);
  }, [locations, selectedLocationId]);

  useEffect(() => {
    setSelectedLesson(null);
  }, [selectedLocationId]);

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

  useEffect(() => {
    if (!selectedLesson) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedLesson(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedLesson]);

  const groupLessonsForDay = useMemo(
    () => monthScheduleDates.filter((item) => item.date === selectedDate),
    [monthScheduleDates, selectedDate]
  );

  const locationPersonalLessons = useMemo(
    () =>
      personalLessons.filter((lesson) => (lesson.locationId ?? null) === selectedLocationId),
    [personalLessons, selectedLocationId]
  );

  const personalForDay = useMemo(
    () =>
      locationPersonalLessons
        .filter((l) => l.date === selectedDate)
        .sort((a, b) => a.timeStart.localeCompare(b.timeStart)),
    [locationPersonalLessons, selectedDate]
  );

  const dayScheduleEntries = useMemo((): DayLessonEntry[] => {
    const entries: DayLessonEntry[] = [
      ...groupLessonsForDay.map((slot) => ({
        kind: "group" as const,
        start: slot.time,
        key: `g-${slot.date}|${slot.time}|${slot.disciplineId ?? "none"}`,
        time: slot.time,
        timeEnd: slot.timeEnd,
        disciplineId: slot.disciplineId ?? null,
        label: slot.groupName
          ? `${slot.groupName} · ${slot.time} – ${slot.timeEnd}`
          : `Групповой урок · ${slot.time} – ${slot.timeEnd}`,
      })),
      ...personalForDay.map((lesson) => ({
        kind: "personal" as const,
        start: lesson.timeStart,
        key: `p-${lesson.id}`,
        lesson,
        label: `${lesson.clientDisplay} · ${lesson.timeStart} – ${lesson.timeEnd}`,
      })),
    ];
    return entries.sort((a, b) => a.start.localeCompare(b.start));
  }, [groupLessonsForDay, personalForDay]);

  const subsOptions = useMemo(() => {
    if (!selectedLesson) return undefined;
    if (selectedLesson.kind === "group") {
      return {
        category: "group" as const,
        disciplineId: selectedLesson.disciplineId ?? null,
      };
    }
    if (selectedLesson.lesson.subscriptionId) {
      return { subscriptionIds: [selectedLesson.lesson.subscriptionId] };
    }
    return { subscriptionIds: [] as string[] };
  }, [selectedLesson]);

  const { subs: modalSubs = [], isLoading: subsLoading, isError: subsError, error: subsErr } = useSubsForDate(
    selectedLesson ? selectedDate : undefined,
    subsOptions,
    selectedMonth
  );

  const markAttendance = useMarkAttendance();
  const markPersonalAttendance = useMarkPersonalLessonAttendance();
  const { can } = usePermissions();
  const { freezePolicy } = useSettings();
  const isLoading =
    locationsLoading ||
    (selectedLocationId != null && (scheduleLoading || personalLoading || pricesLoading));
  const isError =
    locationsError ||
    (selectedLocationId != null && (scheduleError || personalError || pricesError));
  const error = locationsErr ?? scheduleErr ?? personalErr ?? pricesErr;
  const canMarkAttendance = isDateMarkable(selectedDate) && can("attendance.write");

  const calendarCells = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    if (!year || !month) return [];

    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startOffset = (jsDayToIsoDow(firstDay.getDay()) + 6) % 7;

    const groupDates = new Set(monthScheduleDates.map((d) => d.date));
    const personalDates = new Set(
      locationPersonalLessons.filter((l) => l.date.startsWith(selectedMonth)).map((l) => l.date)
    );

    const cells: Array<{
      date: string | null;
      day: number | null;
      hasGroup: boolean;
      hasPersonal: boolean;
      isToday: boolean;
    }> = [];

    for (let i = 0; i < startOffset; i++) {
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
        hasPersonal: personalDates.has(date),
        isToday: date === today,
      });
    }

    return cells;
  }, [selectedMonth, monthScheduleDates, locationPersonalLessons]);

  const handleMonthNav = (delta: number) => {
    const nextMonth = shiftMonth(selectedMonth, delta);
    setSelectedMonth(nextMonth);
    const [y, m] = nextMonth.split("-").map(Number);
    const currentDay = parseInt(selectedDate.split("-")[2], 10);
    const daysInNext = new Date(y, m, 0).getDate();
    const day = Math.min(currentDay, daysInNext);
    setSelectedDate(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
    setSelectedLesson(null);
  };

  const handleMark = async (subId: string, status: "present" | "absent" | "freeze", student: SubForDate) => {
    if (connectionState !== "online") {
      toast(getMutationBlockedMessage(connectionState), "error");
      return;
    }
    if (!canMarkAttendance) {
      toast("Отметки доступны только за прошедшие и текущий день.", "error");
      return;
    }

    if (status === "freeze") {
      if (!canApplyFreeze(student.lessonsTotal, student.freezeUsed, freezePolicy)) {
        toast(freezeUnavailableMessage(freezePolicy), "error");
        return;
      }
      if (student.freezeUsed >= freezePolicy.freezeMaxCount && student.currentStatus !== "freeze") {
        toast(freezeAlreadyUsedMessage(freezePolicy), "error");
        return;
      }
    }

    const disciplineId =
      selectedLesson?.kind === "group" ? selectedLesson.disciplineId ?? null : null;

    const res = await markAttendance.mutateAsync({
      dateStr: selectedDate,
      subId,
      status,
      disciplineId,
    });
    if (!res.success) {
      toast(res.error || "Не удалось сохранить отметку", "error");
    } else {
      toast(
        `Отмечено: ${status === "present" ? "присутствие" : status === "absent" ? "отсутствие" : "заморозка"}`,
        "success"
      );
    }
  };

  const handleMarkPersonal = async (lessonId: string, status: "present" | "absent") => {
    if (connectionState !== "online") {
      toast(getMutationBlockedMessage(connectionState), "error");
      return;
    }
    if (!canMarkAttendance) {
      toast("Отметки доступны только за прошедшие и текущий день.", "error");
      return;
    }

    const res = await markPersonalAttendance.mutateAsync({ lessonId, status });
    if (!res.success) {
      toast(res.error || "Не удалось сохранить отметку", "error");
    } else {
      toast(`Отмечено: ${status === "present" ? "присутствие" : "отсутствие"}`, "success");
    }
  };

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
    void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
    toast("Списки посещений обновлены", "info");
  };

  const renderAttendanceRow = (st: SubForDate, showFreeze: boolean) => {
    const hasLowCredits = st.lessonsLeft <= 2;
    const fullname = [st.client1, st.client2, st.client3].filter(Boolean).join(" & ");
    const freezeLocked = !st.canFreeze && st.currentStatus !== "freeze";
    const tariffLabel = getSubscriptionTariffLabel(st, prices);

    return (
      <div
        key={st.subId}
        className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 last:border-0"
      >
        <div className="space-y-1.5 flex-1 pr-4">
          <p className="text-[11px] font-sans font-semibold text-indigo-700 leading-snug">{tariffLabel}</p>
          <div className="space-y-0.5">
            <h4 className="text-sm font-semibold text-slate-800 leading-tight">{fullname}</h4>
            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400 font-sans">
              <span>Баланс:</span>
              <strong className={`font-semibold ${hasLowCredits ? "text-rose-600" : "text-slate-700"}`}>
                {st.lessonsLeft} из {st.lessonsTotal}
              </strong>
              <span>· с {st.activationDate}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleMark(st.subId, "present", st)}
            disabled={connectionState !== "online" || !canMarkAttendance || markAttendance.isPending}
            title={getConnectionBlockReason(connectionState)}
            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
              st.currentStatus === "present"
                ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
            }`}
          >
            <Check className="w-3.5 h-3.5" />
            Пришёл
          </button>

          <button
            onClick={() => handleMark(st.subId, "absent", st)}
            disabled={connectionState !== "online" || !canMarkAttendance || markAttendance.isPending}
            title={getConnectionBlockReason(connectionState)}
            className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
              st.currentStatus === "absent"
                ? "bg-rose-600 border-rose-600 text-white shadow-xs"
                : "bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:bg-rose-50"
            }`}
          >
            <X className="w-3.5 h-3.5" />
            Не пришёл
          </button>

          {showFreeze && (
            <button
              onClick={() => handleMark(st.subId, "freeze", st)}
              disabled={connectionState !== "online" || !canMarkAttendance || markAttendance.isPending || freezeLocked}
              title={
                getConnectionBlockReason(connectionState) ??
                (freezeLocked
                  ? "Заморозка доступна один раз для абонементов на 8 уроков"
                  : "Заморозить занятие")
              }
              className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all border disabled:opacity-60 ${
                st.currentStatus === "freeze"
                  ? "bg-sky-600 border-sky-600 text-white shadow-xs cursor-pointer"
                  : freezeLocked
                    ? "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed"
                    : "bg-white border-slate-200 text-slate-600 hover:border-sky-300 hover:bg-sky-50 cursor-pointer"
              }`}
            >
              <Snowflake className="w-3.5 h-3.5" />
              Фриз
            </button>
          )}
        </div>
      </div>
    );
  };

  const modalTitle =
    selectedLesson?.kind === "group"
      ? `Групповой урок · ${selectedLesson.time} – ${selectedLesson.timeEnd}`
      : selectedLesson?.label ?? "Урок";

  const activePersonalLesson =
    selectedLesson?.kind === "personal"
      ? locationPersonalLessons.find((l) => l.id === selectedLesson.lesson.id) ?? selectedLesson.lesson
      : null;

  const isPersonalOneOffView =
    selectedLesson?.kind === "personal" &&
    !selectedLesson.lesson.subscriptionId &&
    !!activePersonalLesson;

  const isSubsListView =
    !!selectedLesson && !isPersonalOneOffView && !subsError && !subsLoading && modalSubs.length > 0;

  const useVirtualSubsList = isSubsListView && modalSubs.length >= 20;

  if (isError) {
    return (
      <div id="panel-attendance" className="panel-page-stack">
        <QueryErrorState error={error} />
      </div>
    );
  }

  if (!selectedLocationId) {
    return (
      <div id="panel-attendance" className="panel-page-stack">
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
          <div className="panel-card-stack">
            <h2 className="text-base font-semibold tracking-tight text-slate-800">Журнал посещений и календарь</h2>
            <p className="text-xs text-slate-400">Выберите локацию, чтобы открыть расписание и журнал посещений.</p>
          </div>

          {isLoading ? (
            <LoadingState label="Загрузка локаций..." />
          ) : locations.length === 0 ? (
            <div className="text-center py-16 text-slate-400 space-y-3">
              <MapPin className="w-8 h-8 mx-auto text-slate-300" />
              <p className="text-sm">Локаций пока нет.</p>
              <p className="text-xs font-sans">
                Добавьте залы в{" "}
                <Link
                  to="/settings/locations"
                  className="text-indigo-600 hover:text-indigo-800 font-semibold underline-offset-2 hover:underline"
                >
                  Настройки · Локации
                </Link>
                .
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => setSelectedLocationId(loc.id)}
                  className="w-full flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40 transition-all cursor-pointer text-left"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">{loc.name}</p>
                    {loc.address ? (
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{loc.address}</p>
                    ) : (
                      <p className="text-[11px] text-slate-300 italic mt-0.5">адрес не указан</p>
                    )}
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
      <div id="panel-attendance" className="panel-page-stack">
        <LoadingState label="Загрузка журнала посещений..." />
      </div>
    );
  }

  return (
    <div id="panel-attendance" className="panel-page-stack">
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="panel-card-stack">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setSelectedLocationId(null);
                  setSelectedLesson(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Все локации
              </button>
              <h2 className="text-base font-semibold tracking-tight text-slate-800">
                Журнал посещений и календарь
              </h2>
              {selectedLocation && (
                <p className="text-xs text-slate-500 font-sans flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                  {selectedLocation.name}
                </p>
              )}
            </div>
            <button
              onClick={handleRefresh}
              className="shrink-0 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Обновить
            </button>
          </div>
          <p className="w-full text-xs text-slate-400">
            Выберите день, затем урок — откроется журнал с абонементами.
          </p>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 border-b border-slate-200">
            <button
              type="button"
              onClick={() => handleMonthNav(-1)}
              className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">{formatMonthTitleRu(selectedMonth)}</span>
            <button
              type="button"
              onClick={() => handleMonthNav(1)}
              className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 bg-slate-50/50">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="text-center text-[10px] font-sans font-semibold text-slate-400 uppercase py-2">
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
                  onClick={() => {
                    setSelectedDate(cell.date!);
                    setSelectedLesson(null);
                  }}
                  className={`min-h-[52px] bg-white p-1.5 flex flex-col items-center justify-start gap-1 transition-colors cursor-pointer ${
                    isSelected ? "ring-2 ring-inset ring-indigo-500 bg-indigo-50/60" : "hover:bg-slate-50"
                  }`}
                >
                  <span
                    className={`text-sm font-semibold leading-none ${
                      cell.isToday
                        ? "w-6 h-6 flex items-center justify-center rounded-full bg-indigo-600 text-white"
                        : isSelected
                          ? "text-indigo-700"
                          : "text-slate-700"
                    }`}
                  >
                    {cell.day}
                  </span>
                  <div className="flex items-center gap-0.5 min-h-[6px]">
                    {cell.hasGroup && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" title="Групповой урок" />
                    )}
                    {cell.hasPersonal && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-700" title="Персональный урок" />
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex items-center gap-4 text-[10px] text-slate-500 font-sans">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-500" /> групповой
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-700" /> персональный
            </span>
          </div>
        </div>

        <p className="text-xs text-slate-500 font-sans leading-relaxed">
          Изменить расписание можно в{" "}
          <Link to="/schedule" className="text-indigo-600 hover:text-indigo-800 font-semibold underline-offset-2 hover:underline">
            Расписание групп
          </Link>{" "}
          и в{" "}
          <Link to="/personal" className="text-indigo-600 hover:text-indigo-800 font-semibold underline-offset-2 hover:underline">
            Персональные уроки
          </Link>
          .
        </p>

        {selectedDate && (
          <div className="panel-card-stack">
            <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
              <p className="text-xs font-semibold text-slate-700">{formatAttendanceDate(selectedDate)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 font-sans">Расписание выбранного дня</p>
              {!canMarkAttendance && (
                <p className="text-[10px] text-amber-600 mt-1 font-sans">
                  Отметки посещаемости доступны только за прошедшие и текущий день.
                </p>
              )}
            </div>

            {dayScheduleEntries.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-widest">Журнал уроков</h3>
                {dayScheduleEntries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setSelectedLesson(entry)}
                    className={`w-full flex items-center justify-between gap-3 p-3 rounded-xl border transition-all cursor-pointer text-left ${
                      entry.kind === "group"
                        ? "bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                        : "bg-white border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <p
                        className={`text-[10px] font-sans font-semibold uppercase tracking-wider ${
                          entry.kind === "group" ? "text-indigo-600" : "text-indigo-700"
                        }`}
                      >
                        {entry.kind === "group" ? "Групповой" : "Персональный"}
                        {entry.kind === "personal" && entry.lesson.subscriptionId ? " · абонемент" : ""}
                      </p>
                      <p className="text-sm font-semibold text-slate-800 mt-0.5 truncate">{entry.label}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 font-sans text-center py-6">На этот день нет уроков в расписании.</p>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedLesson && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedLesson(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-lg w-full max-h-[85vh] flex flex-col"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 shrink-0">
                <div>
                  <h3 className="text-base font-semibold tracking-tight text-slate-900">{modalTitle}</h3>
                  <p className="text-xs text-slate-400 mt-0.5 font-sans">{formatDayMonthRu(selectedDate)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLesson(null)}
                  aria-label="Закрыть"
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div
                className={`px-4 py-3 flex-1 min-h-0 ${useVirtualSubsList ? "" : "overflow-y-auto"}`}
              >
                {isPersonalOneOffView ? (
                  <div className="rounded-xl border border-slate-200 p-4 space-y-3">
                    <div className="space-y-2">
                      <p className="text-sm font-semibold text-slate-800">{activePersonalLesson.clientDisplay}</p>
                      <p className="text-xs text-slate-500 font-sans">
                        Разовый урок · {formatCurrency(activePersonalLesson.price)}
                      </p>
                      <p className="text-xs font-sans">
                        Оплата:{" "}
                        <span
                          className={
                            activePersonalLesson.paid === "yes"
                              ? "text-indigo-600 font-semibold"
                              : "text-rose-600 font-semibold"
                          }
                        >
                          {activePersonalLesson.paid === "yes" ? "оплачен" : "не оплачен"}
                        </span>
                      </p>
                    </div>

                    {!canMarkAttendance ? (
                      <p className="text-[11px] text-amber-600 font-sans">
                        Отметки посещаемости доступны только за прошедшие и текущий день.
                      </p>
                    ) : (
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleMarkPersonal(activePersonalLesson.id, "present")}
                          disabled={connectionState !== "online" || markPersonalAttendance.isPending}
                          title={getConnectionBlockReason(connectionState)}
                          className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
                            activePersonalLesson.attendanceStatus === "present"
                              ? "bg-indigo-600 border-indigo-600 text-white shadow-xs"
                              : "bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          Пришёл
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMarkPersonal(activePersonalLesson.id, "absent")}
                          disabled={connectionState !== "online" || markPersonalAttendance.isPending}
                          title={getConnectionBlockReason(connectionState)}
                          className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
                            activePersonalLesson.attendanceStatus === "absent"
                              ? "bg-rose-600 border-rose-600 text-white shadow-xs"
                              : "bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:bg-rose-50"
                          }`}
                        >
                          <X className="w-3.5 h-3.5" />
                          Не пришёл
                        </button>
                      </div>
                    )}
                  </div>
                ) : subsError ? (
                  <QueryErrorState error={subsErr} />
                ) : subsLoading ? (
                  <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
                    <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
                    <p className="text-xs">Загрузка абонементов...</p>
                  </div>
                ) : modalSubs.length === 0 ? (
                  <div className="text-center py-20 text-slate-400 space-y-3">
                    <Ticket className="w-8 h-8 mx-auto text-slate-300" />
                    <p className="text-sm">Нет активных абонементов для этого урока.</p>
                  </div>
                ) : (
                  <div>
                    {!canMarkAttendance && (
                      <p className="text-[11px] text-amber-600 font-sans mb-3">
                        Отметки посещаемости доступны только за прошедшие и текущий день.
                      </p>
                    )}
                    <p className="text-[10px] font-sans bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full font-semibold inline-block mb-3 tabular-nums">
                      {modalSubs.length}{" "}
                      {pluralizeRu(modalSubs.length, ["абонемент", "абонемента", "абонементов"])}
                    </p>
                    {useVirtualSubsList ? (
                      <VirtualList
                        items={modalSubs}
                        estimateSize={96}
                        maxHeight="min(60vh, 480px)"
                        getKey={(st) => st.subId}
                        renderItem={(st) =>
                          renderAttendanceRow(st, selectedLesson.kind === "group")
                        }
                      />
                    ) : (
                      modalSubs.map((st) =>
                        renderAttendanceRow(st, selectedLesson.kind === "group")
                      )
                    )}
                  </div>
                )}
              </div>

              <div className="border-t border-slate-100 px-4 py-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setSelectedLesson(null)}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans text-xs rounded-lg transition-colors cursor-pointer"
                >
                  Закрыть
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
