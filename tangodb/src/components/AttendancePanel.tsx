/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, X, Snowflake, Loader2, RefreshCw } from "lucide-react";
import {
  attendanceQueryKey,
  useMarkAttendance,
  useScheduleDates,
  useSubsForDate,
} from "../hooks/useAttendance";
import { dowShort, jsDayToIsoDow, pluralizeRu } from "../lib/utils";
import { useUIStore } from "../store/ui";
import type { ToastType } from "../App";
import type { SubForDate } from "../types";

interface AttendancePanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-mono uppercase tracking-wider font-bold block";

const fieldCls =
  "w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all";

function formatAttendanceDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  const month = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(date);
  return `${d} ${month} (${dowShort(jsDayToIsoDow(date.getDay()))})`;
}

export default function AttendancePanel({ toast }: AttendancePanelProps) {
  const queryClient = useQueryClient();
  const selectedMonth = useUIStore((s) => s.selectedMonth);
  const setSelectedMonth = useUIStore((s) => s.setSelectedMonth);

  const { dates: availableDates = [], isLoading: scheduleLoading } = useScheduleDates(selectedMonth);
  const [selectedDateVal, setSelectedDateVal] = useState("");

  const selectedDateStr = selectedDateVal ? selectedDateVal.split("|")[0] : undefined;
  const { subs: students = [], isLoading: subsLoading } = useSubsForDate(selectedDateStr);
  const markAttendance = useMarkAttendance();

  const isLoading = scheduleLoading || subsLoading;

  useEffect(() => {
    if (availableDates.length > 0) {
      setSelectedDateVal(`${availableDates[0].date}|${availableDates[0].time}`);
    } else {
      setSelectedDateVal("");
    }
  }, [selectedMonth, availableDates]);

  const handleMark = async (
    studentIdx: number,
    subId: string,
    status: "present" | "absent" | "freeze"
  ) => {
    if (!selectedDateVal) return;
    const [dateStr] = selectedDateVal.split("|");
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

    const res = await markAttendance.mutateAsync({ dateStr, subId, status });
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

  const displayDate = selectedDateVal ? selectedDateVal.split("|")[0] : "";

  return (
    <div id="panel-attendance" className="space-y-6">
      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-xs space-y-4">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-slate-800">Журнал посещений</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Выберите месяц — система подставит дни занятий согласно расписанию.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div className="space-y-1.5 md:col-span-1">
            <label className={labelCls}>Месяц занятий</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className={fieldCls}
            />
          </div>

          <div className="space-y-1.5 md:col-span-2">
            <label className={labelCls}>Занятие по расписанию</label>
            <select value={selectedDateVal} onChange={(e) => setSelectedDateVal(e.target.value)} className={fieldCls}>
              <option value="">— выберите урок —</option>
              {availableDates.map((item) => (
                <option key={`${item.date}|${item.time}`} value={`${item.date}|${item.time}`}>
                  {formatAttendanceDate(item.date)} в {item.time}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1">
            <button
              onClick={handleRefresh}
              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-xs font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Обновить
            </button>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 border border-slate-200 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-3">
          <h3 className="text-sm font-bold tracking-tight text-slate-800">
            {displayDate ? `Танцоры на ${formatAttendanceDate(displayDate)}` : "Класс не выбран"}
          </h3>
          <span className="text-[10px] font-mono bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-full font-bold shrink-0">
            {students.length} {pluralizeRu(students.length, ["студент", "студента", "студентов"])}
          </span>
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
                    <h4 className="text-sm font-bold text-slate-800 leading-tight">{fullname}</h4>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400 font-mono">
                      <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-[10px] uppercase font-bold">
                        {st.type === "solo" ? "Соло" : "Парный"}
                      </span>
                      <span>Баланс:</span>
                      <strong className={`font-bold ${hasLowCredits ? "text-rose-600" : "text-slate-700"}`}>
                        {st.lessonsLeft} из {st.lessonsTotal}
                      </strong>
                      <span>· с {st.activationDate}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleMark(idx, st.subId, "present")}
                      disabled={markAttendance.isPending}
                      className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all border cursor-pointer disabled:opacity-60 ${
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
                      className={`flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-all border cursor-pointer disabled:opacity-60 ${
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
                      title={freezeLocked ? "Заморозка доступна один раз для абонементов на 8 уроков" : "Заморозить занятие"}
                      className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all border disabled:opacity-60 ${
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
    </div>
  );
}
