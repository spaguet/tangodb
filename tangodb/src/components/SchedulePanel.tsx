/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { CalendarDays, Clock, Trash2, ShieldCheck, CalendarRange } from "lucide-react";
import { ScheduleSlot } from "../types";

interface SchedulePanelProps {
  schedule: ScheduleSlot[];
  onAddScheduleSlot: (dayOfWeek: number, time: string) => Promise<{ success: boolean; error?: string }>;
  onDeleteScheduleSlot: (dayOfWeek: number, time: string) => Promise<{ success: boolean; error?: string }>;
  toast: (msg: string) => void;
}

const DAY_NAMES = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  7: "Воскресенье"
};

export default function SchedulePanel({
  schedule,
  onAddScheduleSlot,
  onDeleteScheduleSlot,
  toast,
}: SchedulePanelProps) {
  const [day, setDay] = useState<number>(1);
  const [time, setTime] = useState<string>("19:00");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!time) {
      toast("⚠️ Укажите время занятия.");
      return;
    }

    toast("⏳ Добавление слота...");
    const res = await onAddScheduleSlot(day, time);
    if (!res.success) {
      toast(`⚠️ Ошибка: ${res.error || "Этот слот уже занят"}`);
    } else {
      toast(`✅ Добавлен класс: ${DAY_NAMES[day as 1 | 2]} в ${time}`);
    }
  };

  const handleRemove = async (dayNum: number, timeVal: string) => {
    const check = window.confirm(`Удалить групповой класс в ${DAY_NAMES[dayNum as 1 | 2]} в ${timeVal} из расписания?`);
    if (!check) return;

    toast("⏳ Удаление слота...");
    const res = await onDeleteScheduleSlot(dayNum, timeVal);
    if (!res.success) {
      toast(`⚠️ Ошибка: ${res.error || "Не удалось удалить слот"}`);
    } else {
      toast("🗑 Класс успешно убран из сетки вещания");
    }
  };

  // Group slots by day
  const groupSlots = () => {
    const groups: Record<number, string[]> = {};
    schedule.forEach(s => {
      const d = s.dayOfWeek;
      if (!groups[d]) groups[d] = [];
      groups[d].push(s.time);
    });
    return groups;
  };

  const grouped = groupSlots();
  const sortedDaysKeys = Object.keys(grouped).map(Number).sort((a, b) => a - b);

  return (
    <div id="panel-schedule" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
      {/* COLUMN 1: NEW CLASS SLOT CREATOR */}
      <div className="lg:col-span-4 bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-5">
        <div className="flex items-center gap-2.5 text-wine-900 border-b border-stone-50 pb-3">
          <CalendarDays className="w-5 h-5 text-gold-500" />
          <h2 className="font-serif text-lg font-bold">Внести новое занятие</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 font-sans text-sm">
          <div className="space-y-1">
            <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">День Недели</label>
            <select
              value={day}
              onChange={(e) => setDay(parseInt(e.target.value))}
              className="w-full bg-stone-50 border border-stone-200 outline-none rounded-xl px-4 py-3 text-sm focus:border-gold-400 focus:bg-white transition-all appearance-none cursor-pointer font-sans"
            >
              {Object.entries(DAY_NAMES).map(([val, name]) => (
                <option key={val} value={val}>{name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Время начала</label>
            <div className="relative font-mono">
              <Clock className="w-4 h-4 text-stone-300 absolute left-4 top-3.5 pointer-events-none" />
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className="w-full bg-stone-50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl pl-11 pr-4 py-3 text-sm transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full py-3.5 bg-gold-400 hover:bg-gold-500 text-stone-900 font-mono text-xs font-bold tracking-widest uppercase rounded-xl transition-all cursor-pointer"
          >
            Вписать в сетку
          </button>
        </form>
      </div>

      {/* COLUMN 2: CURRENT TIMETABLE GRID */}
      <div className="lg:col-span-8 bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-5">
        <div className="flex items-center gap-2.5 text-stone-850 border-b border-stone-50 pb-3">
          <CalendarRange className="w-5 h-5 text-gold-500" />
          <h2 className="font-serif text-lg font-bold">Утвержденная Сетка Расписания</h2>
        </div>

        {sortedDaysKeys.length === 0 ? (
          <div className="text-center py-20 text-stone-400 space-y-1.5 font-sans">
            <span className="text-2xl font-serif">🗓</span>
            <p className="text-sm">Расписание пока пустое. Заполните левую форму, чтобы ученики отображались в журнале.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-sans">
            {sortedDaysKeys.map(dayKey => {
              const times = grouped[dayKey].sort();

              return (
                <div
                  key={dayKey}
                  className="bg-stone-50/50 rounded-2xl border border-stone-100 p-4.5 space-y-3"
                >
                  {/* Day Header */}
                  <div className="flex items-center gap-2.5 text-wine-900 pb-2 border-b border-stone-200/40">
                    <span className="w-2 h-2 rounded-full bg-gold-400 shadow-sm shadow-gold-500/20" />
                    <span className="font-serif font-black text-sm tracking-wide">
                      {DAY_NAMES[dayKey as 1 | 2]}
                    </span>
                  </div>

                  {/* Slots list */}
                  <div className="space-y-2">
                    {times.map((slotTime, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between py-1.5 px-2.5 bg-white border border-stone-200/30 rounded-lg text-sm group"
                      >
                        <span className="font-mono text-stone-700 font-bold">
                          🕐 {slotTime}
                        </span>
                        <button
                          onClick={() => handleRemove(dayKey, slotTime)}
                          className="p-1 text-stone-300 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all cursor-pointer"
                          title="Убрать слот"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
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
