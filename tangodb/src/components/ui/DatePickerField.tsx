import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { jsDayToIsoDow } from "../../lib/utils";
import { toISODateLocal } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import { fieldCls } from "./AppSelect";

interface DatePickerFieldProps {
  label?: string;
  value: string;
  onChange: (isoDate: string) => void;
  min?: string;
  required?: boolean;
  className?: string;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const triggerCls = `${fieldCls} flex items-center gap-2 hover:border-indigo-300 text-left cursor-pointer`;

function buildMonthGrid(viewMonth: Date): (Date | null)[] {
  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = jsDayToIsoDow(firstDay.getDay()) - 1;

  const cells: (Date | null)[] = Array.from({ length: startOffset }, () => null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    cells.push(new Date(year, month, d));
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }
  return cells;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function DatePickerField({
  label,
  value,
  onChange,
  min,
  required,
  className,
}: DatePickerFieldProps) {
  const { t, locale, formatDate } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const parsedValue = value ? new Date(`${value}T12:00:00`) : null;
  const [viewMonth, setViewMonth] = useState(() => {
    if (parsedValue && !Number.isNaN(parsedValue.getTime())) {
      return new Date(parsedValue.getFullYear(), parsedValue.getMonth(), 1);
    }
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const cells = useMemo(() => buildMonthGrid(viewMonth), [viewMonth]);
  const monthLabel = viewMonth.toLocaleDateString(locale, { month: "long", year: "numeric" });
  const weekdayHeaders = [
    t("utils.dow.short.mon"),
    t("utils.dow.short.tue"),
    t("utils.dow.short.wed"),
    t("utils.dow.short.thu"),
    t("utils.dow.short.fri"),
    t("utils.dow.short.sat"),
    t("utils.dow.short.sun"),
  ];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!value) return;
    const d = new Date(`${value}T12:00:00`);
    if (Number.isNaN(d.getTime())) return;
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [value]);

  const isDisabled = (day: Date): boolean => {
    if (!min) return false;
    return toISODateLocal(day) < min;
  };

  const handleSelect = (day: Date) => {
    const iso = toISODateLocal(day);
    if (isDisabled(day)) return;
    onChange(iso);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`field-stack relative ${className ?? ""}`}>
      {label && (
        <label className={labelCls}>
          {label}
          {required ? " *" : ""}
        </label>
      )}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${triggerCls} ${!value ? "text-slate-400" : "text-slate-700"}`}
      >
        <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
        <span>{value ? formatDate(value, { day: "numeric", month: "long", year: "numeric" }) : t("ui.datePicker.selectDate")}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("common.selectDate")}
          className="absolute left-0 right-0 top-full mt-1 z-50 rounded-xl border border-slate-200 bg-white shadow-lg p-3"
        >
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
              aria-label={t("ui.datePicker.prevMonth")}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-slate-800 capitalize">{monthLabel}</span>
            <button
              type="button"
              onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
              aria-label={t("ui.datePicker.nextMonth")}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {weekdayHeaders.map((d) => (
              <div
                key={d}
                className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 py-1"
              >
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, idx) => {
              if (!day) {
                return <div key={`empty-${idx}`} className="h-8" />;
              }

              const iso = toISODateLocal(day);
              const selected = value === iso;
              const isToday = isSameDay(day, today);
              const disabled = isDisabled(day);

              return (
                <button
                  key={iso}
                  type="button"
                  disabled={disabled}
                  onClick={() => handleSelect(day)}
                  className={`h-8 rounded-md text-xs font-semibold transition-colors ${
                    disabled
                      ? "text-slate-300 cursor-not-allowed"
                      : selected
                        ? "bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer"
                        : isToday
                          ? "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 cursor-pointer"
                          : "text-slate-700 hover:bg-slate-100 cursor-pointer"
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
