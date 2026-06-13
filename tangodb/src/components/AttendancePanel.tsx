/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X, Snowflake, Loader2, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import {
  attendanceQueryKey,
  useMarkAttendance,
  useScheduleDates,
  useSubsForDate,
} from "../hooks/useAttendance";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { dowShort, formatDayMonthRu, jsDayToIsoDow, pluralizeRu } from "../lib/utils";
import { useUIStore } from "../store/ui";
import type { ToastType } from "../App";
import type { SubForDate } from "../types";

interface AttendancePanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatAttendanceDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  const month = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(date);
  return `${d} ${month} (${dowShort(jsDayToIsoDow(date.getDay()))})`;
}

function formatMonthTitle(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleString("ru-RU", { month: "long", year: "numeric" });
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function AttendancePanel({ toast }: AttendancePanelProps) {
  const queryClient = useQueryClient();
  const selectedMonth = useUIStore((s) => s.selectedMonth);
  const setSelectedMonth = useUIStore((s) => s.setSelectedMonth);

  const { dates: monthScheduleDates = [], isLoading: scheduleLoading } = useScheduleDates(selectedMonth);
  const { data: personalLessons = [], isLoading: personalLoading } = usePersonalLessons();

  const [selectedDate, setSelectedDate] = useState(todayDateStr);

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

  const groupLessonsForDay = useMemo(
    () => monthScheduleDates.filter((item) => item.date === selectedDate),
    [monthScheduleDates, selectedDate]
  );

  const personalForDay = useMemo(
    () =>
      personalLessons
        .filter((l) => l.date === selectedDate)
        .sort((a, b) => a.timeStart.localeCompare(b.timeStart)),
    [personalLessons, selectedDate]
  );

  const dayScheduleEntries = useMemo(() => {
    const entries = [
      ...groupLessonsForDay.map((slot) => ({
        kind: "group" as const,
        start: slot.time,
        key: `g-${slot.date}|${slot.time}`,
        label: `Групповой урок: ${slot.time} – ${slot.timeEnd}`,
      })),
      ...personalForDay.map((lesson) => ({
        kind: "personal" as const,
        start: lesson.timeStart,
        key: `p-${lesson.id}`,
        label: `${lesson.clientDisplay}: ${lesson.timeStart} – ${lesson.timeEnd}`,
      })),
    ];
    return entries.sort((a, b) => a.start.localeCompare(b.start));
  }, [groupLessonsForDay, personalForDay]);

  const hasGroupClass = groupLessonsForDay.length > 0;

  const { subs: students = [], isLoading: subsLoading } = useSubsForDate(hasGroupClass ? selectedDate : undefined);
  const markAttendance = useMarkAttendance();

  const isLoading = scheduleLoading || subsLoading || personalLoading;

  const calendarCells = useMemo(() => {
    const [year, month] = selectedMonth.split("-").map(Number);
    if (!year || !month) return [];

    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const startOffset = (jsDayToIsoDow(firstDay.getDay()) + 6) % 7;

    const groupDates = new Set(monthScheduleDates.map((d) => d.date));
    const personalDates = new Set(
      personalLessons
        .filter((l) => l.date.startsWith(selectedMonth))
        .map((l) => l.date)
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
  }, [selectedMonth, monthScheduleDates, personalLessons]);

  const handleMonthNav = (delta: number) => {
    const nextMonth = shiftMonth(selectedMonth, delta);
    setSelectedMonth(nextMonth);
    const [y, m] = nextMonth.split("-").map(Number);
    const currentDay = parseInt(selectedDate.split("-")[2], 10);
    const daysInNext = new Date(y, m, 0).getDate();
    const day = Math.min(currentDay, daysInNext);
    setSelectedDate(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  };

  const handleMark = async (
    studentIdx: number,
    subId: string,
    status: "present" | "absent" | "freeze"
  ) => {
    const student = students[studentIdx];

    if (status === "freeze") {
      if (student.lessonsTotal !== 8) {
        toast("Заморозка доступна только для абонементов на 8 уроков.", "error");
        return;
      }
      if (student.freezeUsed > 0 && student.currentStatus !== "freeze") {
        toast("Заморозка по этому абонементу уже использована.", "error");
        return;
      }
    }

    const res = await markAttendance.mutateAsync({ dateStr: selectedDate, subId, status });
    if (!res.success) {
      toast(res.error || "Не удалось сохранить отметку", "error");
    } else {
      toast(
        `Отмечено: ${status === "present" ? "присутствие" : status === "absent" ? "отсутствие" : "заморозка"}`,
        "success"
      );
    }
  };

  const handleRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: attendanceQueryKey });
    toast("Списки посещений обновлены", "info");
  };

  return (
    <div id="panel-attendance" className="panel-page-stack">
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-slate-800">Журнал посещений и календарь</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Выберите день в календаре — отобразятся групповые и персональные занятия.
            </p>
          </div>
          <button
            onClick={handleRefresh}
            className="shrink-0 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center gap-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Обновить
          </button>
        </div>

        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2.5 bg-slate-50 border-b border-slate-200">
            <button
              type="button"
              onClick={() => handleMonthNav(-1)}
              className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800 capitalize">{formatMonthTitle(selectedMonth)}</span>
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
                  className={`min-h-[52px] bg-white p-1.5 flex flex-col items-center justify-start gap-1 transition-colors cursor-pointer ${
                    isSelected
                      ? "ring-2 ring-inset ring-indigo-500 bg-indigo-50/60"
                      : "hover:bg-slate-50"
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
                    {cell.hasGroup && <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" title="Групповой урок" />}
                    {cell.hasPersonal && (
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-500" title="Персональный урок" />
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
              <span className="w-2 h-2 rounded-full bg-violet-500" /> персональный
            </span>
          </div>
        </div>

        {selectedDate && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
            <p className="text-xs font-semibold text-slate-700">{formatAttendanceDate(selectedDate)}</p>
            {dayScheduleEntries.length > 0 ? (
              <div className="mt-1 space-y-0.5">
                {dayScheduleEntries.map((entry) => (
                  <p
                    key={entry.key}
                    className={`text-xs font-sans ${
                      entry.kind === "group" ? "text-slate-500" : "text-violet-600"
                    }`}
                  >
                    {entry.label}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 mt-0.5 font-sans">На этот день нет записей.</p>
            )}
          </div>
        )}
      </div>

      {hasGroupClass && (
        <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
          <div className="border-b border-slate-100 pb-3 space-y-1">
            <h3 className="text-sm font-semibold tracking-tight text-slate-800">
              Журнал посещения группового урока
            </h3>
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-500 font-sans">{formatDayMonthRu(selectedDate)}</span>
              <span className="text-[10px] font-sans bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-semibold shrink-0 tabular-nums">
                {students.length} {pluralizeRu(students.length, ["абонемент", "абонемента", "абонементов"])}
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
              <Loader2 className="w-7 h-7 text-indigo-500 animate-spin" />
              <p className="text-xs">Загрузка карточек учеников...</p>
            </div>
          ) : students.length === 0 ? (
            <div className="text-center py-20 text-slate-400">
              <p className="text-sm">На выбранную дату нет активных абонементов.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {students.map((st: SubForDate, idx: number) => {
                const hasLowCredits = st.lessonsLeft <= 2;
                const fullname = st.client2 ? `${st.client1} & ${st.client2}` : st.client1;
                const freezeLocked = !st.canFreeze && st.currentStatus !== "freeze";

                return (
                  <div
                    key={st.subId}
                    className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 first:pt-0 last:pb-0"
                  >
                    <div className="space-y-1.5 flex-1 pr-4">
                      <h4 className="text-sm font-semibold text-slate-800 leading-tight">{fullname}</h4>
                      <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400 font-sans">
                        <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[10px] uppercase font-semibold">
                          {st.type === "solo" ? "Соло" : "Парный"}
                        </span>
                        <span>Баланс:</span>
                        <strong className={`font-semibold ${hasLowCredits ? "text-rose-600" : "text-slate-700"}`}>
                          {st.lessonsLeft} из {st.lessonsTotal}
                        </strong>
                        <span>· с {st.activationDate}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleMark(idx, st.subId, "present")}
                        disabled={markAttendance.isPending}
                        className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
                          st.currentStatus === "present"
                            ? "bg-emerald-600 border-emerald-600 text-white shadow-xs"
                            : "bg-white border-slate-200 text-slate-600 hover:border-emerald-300 hover:bg-emerald-50"
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                        Пришёл
                      </button>

                      <button
                        onClick={() => handleMark(idx, st.subId, "absent")}
                        disabled={markAttendance.isPending}
                        className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all border cursor-pointer disabled:opacity-60 ${
                          st.currentStatus === "absent"
                            ? "bg-rose-600 border-rose-600 text-white shadow-xs"
                            : "bg-white border-slate-200 text-slate-600 hover:border-rose-300 hover:bg-rose-50"
                        }`}
                      >
                        <X className="w-3.5 h-3.5" />
                        Н/П
                      </button>

                      <button
                        onClick={() => handleMark(idx, st.subId, "freeze")}
                        disabled={markAttendance.isPending || freezeLocked}
                        title={
                          freezeLocked
                            ? "Заморозка доступна один раз для абонементов на 8 уроков"
                            : "Заморозить занятие"
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
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
