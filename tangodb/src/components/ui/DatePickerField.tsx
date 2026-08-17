import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  max?: string;
  required?: boolean;
  className?: string;
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";
const triggerCls = `${fieldCls} flex items-center gap-2 hover:border-gold-300 text-left cursor-pointer`;
const CALENDAR_MIN_WIDTH = 280;
const CALENDAR_ESTIMATED_HEIGHT = 300;
const MENU_GAP = 4;

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
  max,
  required,
  className,
}: DatePickerFieldProps) {
  const { t, locale, formatDate } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(
    null
  );

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

  const updatePanelPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const width = Math.max(rect.width, CALENDAR_MIN_WIDTH);
    const spaceBelow = window.innerHeight - rect.bottom - MENU_GAP;
    const spaceAbove = rect.top - MENU_GAP;
    const openUp = spaceBelow < CALENDAR_ESTIMATED_HEIGHT && spaceAbove > spaceBelow;
    const panelHeight = panelRef.current?.offsetHeight ?? CALENDAR_ESTIMATED_HEIGHT;

    let left = rect.left;
    if (left + width > window.innerWidth - MENU_GAP) {
      left = Math.max(MENU_GAP, window.innerWidth - width - MENU_GAP);
    }

    setPanelStyle({
      top: openUp ? rect.top - MENU_GAP - panelHeight : rect.bottom + MENU_GAP,
      left,
      width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("scroll", updatePanelPosition, true);
    window.addEventListener("resize", updatePanelPosition);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("scroll", updatePanelPosition, true);
      window.removeEventListener("resize", updatePanelPosition);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    updatePanelPosition();
  }, [open, viewMonth, updatePanelPosition]);

  useEffect(() => {
    if (!value) return;
    const d = new Date(`${value}T12:00:00`);
    if (Number.isNaN(d.getTime())) return;
    setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [value]);

  const isDisabled = (day: Date): boolean => {
    const iso = toISODateLocal(day);
    if (min && iso < min) return true;
    if (max && iso > max) return true;
    return false;
  };

  const handleSelect = (day: Date) => {
    const iso = toISODateLocal(day);
    if (isDisabled(day)) return;
    onChange(iso);
    setOpen(false);
  };

  const calendarPanel =
    open && panelStyle ? (
      <div
        ref={panelRef}
        role="dialog"
        aria-label={t("common.selectDate")}
        style={{
          top: panelStyle.top,
          left: panelStyle.left,
          width: panelStyle.width,
        }}
        className="fixed z-[100] rounded-xl border border-ink-200 bg-white shadow-lg p-3"
      >
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
            aria-label={t("ui.datePicker.prevMonth")}
            className="p-1.5 text-ink-400 hover:text-gold-800 hover:bg-gold-50 rounded-lg transition-all cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-ink-800 capitalize">{monthLabel}</span>
          <button
            type="button"
            onClick={() => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
            aria-label={t("ui.datePicker.nextMonth")}
            className="p-1.5 text-ink-400 hover:text-gold-800 hover:bg-gold-50 rounded-lg transition-all cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-0.5 mb-1">
          {weekdayHeaders.map((d) => (
            <div
              key={d}
              className="text-center text-[10px] font-semibold uppercase tracking-wider text-ink-500 py-1"
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
                    ? "text-ink-300 cursor-not-allowed"
                    : selected
                      ? "bg-gold-700 text-white hover:bg-gold-800 cursor-pointer"
                      : isToday
                        ? "bg-gold-50 text-gold-700 hover:bg-gold-100 cursor-pointer"
                        : "text-ink-700 hover:bg-ink-100 cursor-pointer"
                }`}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    ) : null;

  return (
    <div ref={rootRef} className={`field-stack relative ${className ?? ""}`}>
      {label && (
        <label className={labelCls}>
          {label}
          {required ? " *" : ""}
        </label>
      )}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`${triggerCls} ${!value ? "text-ink-400" : "text-ink-700"}`}
      >
        <CalendarDays className="w-4 h-4 text-ink-400 shrink-0" />
        <span>{value ? formatDate(value, { day: "numeric", month: "long", year: "numeric" }) : t("ui.datePicker.selectDate")}</span>
      </button>

      {calendarPanel ? createPortal(calendarPanel, document.body) : null}
    </div>
  );
}
