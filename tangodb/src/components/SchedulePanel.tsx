/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { CalendarDays, Clock, Trash2, CalendarRange } from "lucide-react";
import { useAddScheduleSlot, useDeleteScheduleSlot, useSchedule } from "../hooks/useSchedule";
import { dowFull, dowFullEntries } from "../lib/utils";
import ConfirmDialog from "./ui/ConfirmDialog";
import LoadingState from "./ui/LoadingState";
import type { ToastType } from "../App";
import type { ScheduleSlot } from "../types";

interface SchedulePanelProps {
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

const fieldCls =
  "w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all";

export default function SchedulePanel({ toast }: SchedulePanelProps) {
  const { data: schedule = [], isLoading } = useSchedule();
  const addSlot = useAddScheduleSlot();
  const deleteSlot = useDeleteScheduleSlot();

  const [day, setDay] = useState<number>(1);
  const [time, setTime] = useState<string>("19:00");
  const [timeEnd, setTimeEnd] = useState<string>("21:00");
  const [deleteTarget, setDeleteTarget] = useState<ScheduleSlot | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!time) {
      toast("Укажите время начала занятия.", "error");
      return;
    }
    if (!timeEnd) {
      toast("Укажите время окончания занятия.", "error");
      return;
    }
    if (timeEnd <= time) {
      toast("Время окончания должно быть позже начала.", "error");
      return;
    }

    const res = await addSlot.mutateAsync({ dayOfWeek: day, time, timeEnd });
    if (!res.success) {
      toast(res.error || "Этот слот уже занят", "error");
    } else {
      toast(`Добавлен класс: ${dowFull(day)} ${time} – ${timeEnd}`, "success");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleteTarget.id == null) return;

    const res = await deleteSlot.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(res.error || "Не удалось удалить слот", "error");
    } else {
      toast("Класс убран из расписания", "success");
      setDeleteTarget(null);
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

  if (isLoading) return <LoadingState label="Загрузка расписания..." />;

  return (
    <div id="panel-schedule" className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
      <div className="lg:col-span-4 bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="flex items-center gap-2.5 text-slate-800 border-b border-slate-100 pb-3">
          <CalendarDays className="w-4.5 h-4.5 text-indigo-500" />
          <h2 className="text-base font-semibold tracking-tight">Внести новое занятие</h2>
        </div>

        <form onSubmit={handleSubmit} className="panel-form-stack">
          <div className="field-stack">
            <label className={labelCls}>День недели</label>
            <select
              value={day}
              onChange={(e) => setDay(parseInt(e.target.value))}
              className={`${fieldCls} appearance-none cursor-pointer`}
            >
              {dowFullEntries().map(([val, name]) => (
                <option key={val} value={val}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="field-stack">
            <label className={labelCls}>Время начала</label>
            <div className="relative font-sans">
              <Clock className="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={`${fieldCls} pl-10`}
              />
            </div>
          </div>

          <div className="field-stack">
            <label className={labelCls}>Время окончания</label>
            <div className="relative font-sans">
              <Clock className="w-4 h-4 text-slate-300 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="time"
                required
                value={timeEnd}
                onChange={(e) => setTimeEnd(e.target.value)}
                className={`${fieldCls} pl-10`}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={addSlot.isPending}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
          >
            {addSlot.isPending ? "Добавление..." : "Вписать в сетку"}
          </button>
        </form>
      </div>

      <div className="lg:col-span-8 bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
        <div className="flex items-center gap-2.5 text-slate-800 border-b border-slate-100 pb-3">
          <CalendarRange className="w-4.5 h-4.5 text-indigo-500" />
          <h2 className="text-base font-semibold tracking-tight">Утверждённая сетка расписания</h2>
        </div>

        {sortedDaysKeys.length === 0 ? (
          <div className="text-center py-20 text-slate-400 space-y-3">
            <CalendarDays className="w-8 h-8 mx-auto text-slate-300" />
            <p className="text-sm">
              Расписание пока пустое. Заполните форму слева, чтобы ученики появились в журнале посещений.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {sortedDaysKeys.map((dayKey) => {
              const slots = grouped[dayKey].sort((a, b) => a.time.localeCompare(b.time));

              return (
                <div key={dayKey} className="bg-slate-50 rounded-xl border border-slate-100 p-4 space-y-3">
                  <div className="flex items-center gap-2.5 text-slate-800 pb-2 border-b border-slate-200/60">
                    <span className="w-2 h-2 rounded-full bg-indigo-500" />
                    <span className="font-semibold text-sm tracking-tight">{dowFull(dayKey)}</span>
                  </div>

                  <div className="space-y-2">
                    {slots.map((slot) => (
                      <div
                        key={slot.id ?? `${slot.dayOfWeek}-${slot.time}`}
                        className="flex items-center justify-between py-1.5 px-2.5 bg-white border border-slate-200/60 rounded-lg text-sm group"
                      >
                        <span className="inline-flex items-center gap-1.5 font-sans text-slate-700 font-semibold">
                          <Clock className="w-3.5 h-3.5 text-slate-400" />
                          {slot.time} – {slot.timeEnd || "21:00"}
                        </span>
                        <button
                          onClick={() => setDeleteTarget(slot)}
                          disabled={deleteSlot.isPending}
                          className="p-1 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all cursor-pointer disabled:opacity-50"
                          title="Убрать слот"
                          aria-label={`Удалить класс ${dowFull(slot.dayOfWeek)} в ${slot.time}`}
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

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить класс из расписания?"
        description={
          deleteTarget ? (
            <>
              Групповой класс{" "}
              <strong className="font-semibold text-slate-800">
                {dowFull(deleteTarget.dayOfWeek)} {deleteTarget.time} – {deleteTarget.timeEnd || "21:00"}
              </strong>{" "}
              будет убран из сетки. Будущие занятия по этому слоту исчезнут из журнала.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Удалить"
        pending={deleteSlot.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
