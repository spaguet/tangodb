/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { Check, X, Snowflake, Calendar, Loader, ShieldAlert, Award } from "lucide-react";
import { useTangoStore } from "../hooks/useTangoStore";

interface AttendancePanelProps {
  getScheduleDatesForMonth: (yearMonth: string) => { date: string; time: string }[];
  getSubsForDate: (dateStr: string) => any[];
  onMarkAttendance: (dateStr: string, subId: string, status: "present" | "absent" | "freeze") => Promise<{ success: boolean; newLessonsLeft?: number; error?: string }>;
  toast: (msg: string) => void;
}

export default function AttendancePanel({
  getScheduleDatesForMonth,
  getSubsForDate,
  onMarkAttendance,
  toast,
}: AttendancePanelProps) {
  const [selectedMonth, setSelectedMonth] = useState("");
  const [availableDates, setAvailableDates] = useState<{ date: string; time: string }[]>([]);
  const [selectedDateVal, setSelectedDateVal] = useState(""); // "date|time"
  const [students, setStudents] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Set initial month to current month
  useEffect(() => {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    setSelectedMonth(`${today.getFullYear()}-${mm}`);
  }, []);

  // Recalculate scheduled classes when Month changes
  useEffect(() => {
    if (!selectedMonth) return;
    const dates = getScheduleDatesForMonth(selectedMonth);
    setAvailableDates(dates);
    if (dates.length > 0) {
      setSelectedDateVal(`${dates[0].date}|${dates[0].time}`);
    } else {
      setSelectedDateVal("");
      setStudents([]);
    }
  }, [selectedMonth, getScheduleDatesForMonth]);

  // Recalculate attendees list when Date changes
  useEffect(() => {
    if (!selectedDateVal) {
      setStudents([]);
      return;
    }
    const [dateStr] = selectedDateVal.split("|");
    setLoading(true);
    const list = getSubsForDate(dateStr);
    setStudents(list);
    setLoading(false);
  }, [selectedDateVal, getSubsForDate]);

  // Handle Mark Attendance Action
  const handleMark = async (studentIdx: number, subId: string, status: "present" | "absent" | "freeze") => {
    if (!selectedDateVal) return;
    const [dateStr] = selectedDateVal.split("|");

    // Capture student metadata to validate freezing
    const student = students[studentIdx];
    if (status === "freeze") {
      if (student.lessonsTotal !== 8) {
        toast("⚠️ Заморозка доступна только для абонементов на 8 уроков.");
        return;
      }
      if (student.freezeUsed > 0 && student.currentStatus !== "freeze") {
        toast("⚠️ Вы уже использовали заморозку по этому абонементу.");
        return;
      }
    }

    // Optimistically update status in UI to feel fast
    const previousStatus = student.currentStatus;
    const nextStudents = [...students];
    nextStudents[studentIdx] = { ...student, currentStatus: status };
    setStudents(nextStudents);

    const res = await onMarkAttendance(dateStr, subId, status);
    if (!res.success) {
      toast(`⚠️ Ошибка отметки: ${res.error || "Не удалось сохранить изменения"}`);
      // Revert upon failure
      const revertedStudents = [...students];
      revertedStudents[studentIdx] = { ...student, currentStatus: previousStatus };
      setStudents(revertedStudents);
    } else {
      toast(`✅ Успешно отмечено: ${status === "present" ? "Присутствие" : status === "absent" ? "Отсутствие" : "Заморозка"}`);
      // Reflect updated lessons count returned from database
      if (res.newLessonsLeft !== undefined) {
        const validatedStudents = [...students];
        validatedStudents[studentIdx] = {
          ...student,
          currentStatus: status,
          lessonsLeft: res.newLessonsLeft
        };
        setStudents(validatedStudents);
      }
    }
  };

  const formatDateRu = (dateStr: string) => {
    const months = ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"];
    const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    const d = new Date(dateStr + "T12:00:00");
    return `${d.getDate()} ${months[d.getMonth()]} (${days[d.getDay()]})`;
  };

  return (
    <div id="panel-attendance" className="space-y-6">
      {/* Date-picker filter card */}
      <div className="bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-4">
        <div>
          <h2 className="font-serif text-xl font-bold text-stone-900">Журнал Посещений</h2>
          <p className="text-xs text-stone-400 font-sans mt-0.5">
            Выберите текущий месяц класса, и система подставит дни занятий согласно расписанию.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end font-sans">
          <div className="space-y-1 md:col-span-1">
            <label className="text-[11px] text-stone-400 font-mono uppercase tracking-wider block">Месяц занятий</label>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 focus:border-gold-400 outline-none rounded-xl px-4 py-2.5 text-sm transition-all"
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <label className="text-[11px] text-stone-400 font-mono uppercase tracking-wider block">Занятие по расписанию</label>
            <select
              value={selectedDateVal}
              onChange={(e) => setSelectedDateVal(e.target.value)}
              className="w-full bg-stone-50 border border-stone-200 focus:border-gold-400 outline-none rounded-xl px-4 py-2.5 text-sm transition-all"
            >
              <option value="">— выберите урок —</option>
              {availableDates.map((item, index) => (
                <option key={index} value={`${item.date}|${item.time}`}>
                  {formatDateRu(item.date)} в {item.time}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-1">
            <button
              onClick={() => {
                const prev = selectedDateVal;
                setSelectedDateVal("");
                setTimeout(() => setSelectedDateVal(prev), 50);
                toast("🔄 Перезагрузка списков посещений");
              }}
              className="w-full py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 font-mono text-xs font-bold uppercase trekking-wider rounded-xl transition-all cursor-pointer"
            >
              🔄 Обновить
            </button>
          </div>
        </div>
      </div>

      {/* Attending Students List */}
      <div className="bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-stone-50 pb-3">
          <h3 className="font-serif text-lg font-bold text-stone-800">
            {selectedDateVal ? `Приглашенные танцоры на ${formatDateRu(selectedDateVal.split("|")[0])}` : "Класс не выбран"}
          </h3>
          <span className="text-xs font-mono bg-gold-50 border border-gold-200/40 text-gold-900 px-3 py-1 rounded-full font-bold">
            {students.length} студентов
          </span>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-stone-400 gap-3">
            <Loader className="w-8 h-8 text-gold-500 animate-spin" />
            <p className="text-xs font-sans">Загрузка карточек учеников из Google-таблицы...</p>
          </div>
        ) : students.length === 0 ? (
          <div className="text-center py-20 text-stone-400 space-y-2">
            <p className="text-stone-300 font-serif italic text-3xl">☕</p>
            <p className="text-sm font-sans">На выбранную дату нет активных абонементов, либо занятие не укомплектовано.</p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100">
            {students.map((st, idx) => {
              const hasLowCredits = st.lessonsLeft <= 2;
              const fullname = st.client2 ? `${st.client1} & ${st.client2}` : st.client1;

              return (
                <div key={idx} className="py-4.5 flex flex-col md:flex-row md:items-center justify-between gap-4 first:pt-0 last:pb-0">
                  <div className="space-y-1.5 flex-1 pr-4">
                    <h4 className="font-serif font-bold text-stone-800 text-base leading-tight">
                      {fullname}
                    </h4>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-stone-400 font-mono">
                      <span className="bg-gold-100 text-gold-800 px-2 py-0.5 rounded text-[10px] uppercase font-bold">
                        {st.type === "solo" ? "Соло" : "Парный"}
                      </span>
                      <span>Баланс:</span>
                      <strong
                        className={`font-bold ${hasLowCredits ? "text-rose-600 font-black animate-pulse" : "text-stone-700"}`}
                      >
                        {st.lessonsLeft} из {st.lessonsTotal} занятий
                      </strong>
                      <span>· с {st.activationDate}</span>
                    </div>
                  </div>

                  {/* Operational status action checkin buttons representing GAS states */}
                  <div className="flex items-center gap-2.5 font-sans">
                    <button
                      onClick={() => handleMark(idx, st.subId, "present")}
                      className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                        st.currentStatus === "present"
                          ? "bg-emerald-600 border-emerald-600 text-white shadow-md shadow-emerald-500/10"
                          : "bg-white border-stone-200 text-stone-600 hover:border-emerald-355 hover:bg-emerald-50/20"
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                      Пришёл
                    </button>

                    <button
                      onClick={() => handleMark(idx, st.subId, "absent")}
                      className={`flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                        st.currentStatus === "absent"
                          ? "bg-rose-600 border-rose-600 text-white shadow-md shadow-rose-500/10"
                          : "bg-white border-stone-200 text-stone-600 hover:border-rose-355 hover:bg-rose-50/20"
                      }`}
                    >
                      <X className="w-3.5 h-3.5" />
                      Н/П
                    </button>

                    <button
                      onClick={() => handleMark(idx, st.subId, "freeze")}
                      disabled={!st.canFreeze && st.currentStatus !== "freeze"}
                      title={
                        !st.canFreeze && st.currentStatus !== "freeze"
                          ? "Заморозка доступна только для абонементов на 8 уроков один раз"
                          : ""
                      }
                      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-bold transition-all border cursor-pointer ${
                        st.currentStatus === "freeze"
                          ? "bg-sky-600 border-sky-600 text-white shadow-md shadow-sky-500/10"
                          : !st.canFreeze
                          ? "bg-stone-50 border-stone-100 text-stone-300 cursor-not-allowed"
                          : "bg-white border-stone-200 text-stone-600 hover:border-sky-355 hover:bg-sky-50/20"
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
