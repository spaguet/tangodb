/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { CalendarDays, Clock, Trash2, CalendarRange } from "lucide-react";
import { useAddScheduleSlot, useDeleteScheduleSlot, useSchedule } from "../hooks/useSchedule";
import { dowFull, dowFullEntries } from "../lib/utils";
import type { ScheduleSlot } from "../types";

interface SchedulePanelProps {
  toast: (msg: string) => void;
}

export default function SchedulePanel({ toast }: SchedulePanelProps) {
  const { data: schedule = [], isLoading } = useSchedule();
  const addSlot = useAddScheduleSlot();
  const deleteSlot = useDeleteScheduleSlot();

  const [day, setDay] = useState<number>(1);
  const [time, setTime] = useState<string>("19:00");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!time) {
      toast("⚠️ Укажите время занятия.");
      return;
    }

    toast("⏳ Добавление слота...");
    const res = await addSlot.mutateAsync({ dayOfWeek: day, time });
    if (!res.success) {
      toast(`⚠️ Ошибка: ${res.error || "Этот слот уже занят"}`);
    } else {
      toast(`✅ Добавлен класс: ${dowFull(day)} в ${time}`);
    }
  };

  const handleRemove = async (slot: ScheduleSlot) => {
    if (slot.id == null) {
      toast("⚠️ Не удалось определить слот для удаления.");
      return;
    }

    const check = window.confirm(
      `Удалить групповой класс в ${dowFull(slot.dayOfWeek)} в ${slot.time} из расписания?`
    );
    if (!check) return;

    toast("⏳ Удаление слота...");
    const res = await deleteSlot.mutateAsync(slot.id);
    if (!res.success) {
      toast(`⚠️ Ошибка: ${res.error || "Не удалось удалить слот"}`);
    } else {
      toast("🗑 Класс успешно убран из сетки вещания");
    }
  };

  const groupSlots = () => {
    const groups: Record<number, ScheduleSlot[]> = {};
    schedule.forEach((s) => {
      const d = s.dayOfWeek;
      if (!groups[d]) groups[d] = [];
      groups[d].push(s);
    });
    return groups;
  };

  const grouped = groupSlots();
  const sortedDaysKeys = Object.keys(grouped)
    .map(Number)
    .sort((a, b) => a - b);

  if (isLoading) return null;

  return (
    <div id="panel-schedule" className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
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
              {dowFullEntries().map(([val, name]) => (
                <option key={val} value={val}>
                  {name}
                </option>
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
            disabled={addSlot.isPending}
            className="w-full py-3.5 bg-gold-400 hover:bg-gold-500 text-stone-900 font-mono text-xs font-bold tracking-widest uppercase rounded-xl transition-all cursor-pointer disabled:opacity-60"
          >
            Вписать в сетку
          </button>
        </form>
      </div>

      <div className="lg:col-span-8 bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-5">
        <div className="flex items-center gap-2.5 text-stone-850 border-b border-stone-50 pb-3">
          <CalendarRange className="w-5 h-5 text-gold-500" />
          <h2 className="font-serif text-lg font-bold">Утвержденная Сетка Расписания</h2>
        </div>

        {sortedDaysKeys.length === 0 ? (
          <div className="text-center py-20 text-stone-400 space-y-1.5 font-sans">
            <span className="text-2xl font-serif">🗓</span>
            <p className="text-sm">
              Расписание пока пустое. Заполните левую форму, чтобы ученики отображались в журнале.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 font-sans">
            {sortedDaysKeys.map((dayKey) => {
              const slots = grouped[dayKey].sort((a, b) => a.time.localeCompare(b.time));

              return (
                <div key={dayKey} className="bg-stone-50/50 rounded-2xl border border-stone-100 p-4.5 space-y-3">
                  <div className="flex items-center gap-2.5 text-wine-900 pb-2 border-b border-stone-200/40">
                    <span className="w-2 h-2 rounded-full bg-gold-400 shadow-sm shadow-gold-500/20" />
                    <span className="font-serif font-black text-sm tracking-wide">{dowFull(dayKey)}</span>
                  </div>

                  <div className="space-y-2">
                    {slots.map((slot) => (
                      <div
                        key={slot.id ?? `${slot.dayOfWeek}-${slot.time}`}
                        className="flex items-center justify-between py-1.5 px-2.5 bg-white border border-stone-200/30 rounded-lg text-sm group"
                      >
                        <span className="font-mono text-stone-700 font-bold">🕐 {slot.time}</span>
                        <button
                          onClick={() => handleRemove(slot)}
                          disabled={deleteSlot.isPending}
                          className="p-1 text-stone-300 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all cursor-pointer disabled:opacity-50"
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
