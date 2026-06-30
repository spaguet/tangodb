import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { Locale } from "../../i18n";
import { dowShort, scheduleLessons, STUDIO_LOCATION } from "../data";

const ROW_H = 16;
const SLOT_MIN = 15;

function toMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function computeRange(lessons: readonly { start: string; end: string }[]) {
  if (lessons.length === 0) return { start: 10 * 60, end: 22 * 60 };
  const mins = lessons.flatMap((l) => [toMin(l.start), toMin(l.end)]);
  const pad = 30;
  const start = Math.max(0, Math.floor((Math.min(...mins) - pad) / 60) * 60);
  const end = Math.min(24 * 60, Math.ceil((Math.max(...mins) + pad) / 60) * 60);
  return { start, end: Math.max(end, start + 120) };
}

type Props = { locale: Locale };

export function SchedulePanel({ locale }: Props) {
  const days = dowShort[locale];
  const weekDays = [1, 2, 3, 4, 5, 6, 7];
  const [expanded, setExpanded] = useState(true);

  const { start: rangeStart, end: rangeEnd } = useMemo(() => computeRange(scheduleLessons), []);
  const gridH = ((rangeEnd - rangeStart) / SLOT_MIN) * ROW_H;
  const rowCount = (rangeEnd - rangeStart) / SLOT_MIN;

  const timeLabels: { top: number; label: string }[] = [];
  for (let min = rangeStart; min < rangeEnd; min += 60) {
    timeLabels.push({
      top: ((min - rangeStart) / SLOT_MIN) * ROW_H,
      label: `${String(Math.floor(min / 60)).padStart(2, "0")}:00`,
    });
  }

  const weekLabel = locale === "ru" ? "23–29 июня 2026" : "Jun 23–29, 2026";

  return (
    <div id="panel-schedule" className="panel-page-stack">
      <div className="sticky top-0 z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white/95 backdrop-blur-[2px] py-1 -mx-1 px-1">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-indigo-500 shrink-0" />
          <h2 className="text-base font-semibold text-slate-800 tracking-tight">
            {locale === "ru" ? "Расписание" : "Schedule"}
          </h2>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" disabled className="p-1.5 rounded-lg text-slate-400 cursor-not-allowed" aria-label="Prev week">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-semibold text-slate-800 min-w-[120px] text-center">{weekLabel}</span>
          <button type="button" disabled className="p-1.5 rounded-lg text-slate-400 cursor-not-allowed" aria-label="Next week">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs demo-field-disabled">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/60 text-left cursor-pointer hover:bg-slate-50 transition-colors rounded-t-xl"
          aria-expanded={expanded}
        >
          <h3 className="text-sm font-semibold text-slate-800 tracking-tight min-w-0 truncate">{STUDIO_LOCATION}</h3>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-slate-500 tabular-nums">{scheduleLessons.length}</span>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
            />
          </div>
        </button>

        {expanded && (
          <div className="isolate overflow-auto max-h-[min(52vh,420px)] sm:max-h-none [-webkit-overflow-scrolling:touch]">
            <div className="flex min-w-[640px]">
              <div className="sticky left-0 z-[1] w-10 sm:w-12 shrink-0 border-r border-slate-100 bg-white shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)]">
                <div
                  className="sticky top-0 z-[2] h-9 sm:h-11 border-b border-slate-100 bg-slate-50/95 backdrop-blur-[2px]"
                  aria-hidden
                />
                <div className="relative" style={{ height: gridH }}>
                  {timeLabels.map(({ top, label }) => (
                    <div
                      key={label}
                      className="absolute right-0.5 sm:right-1 text-[9px] sm:text-[10px] font-semibold text-slate-400 tabular-nums -translate-y-1/2"
                      style={{ top }}
                    >
                      {label}
                    </div>
                  ))}
                  {Array.from({ length: rowCount }, (_, i) => (
                    <div
                      key={i}
                      className="absolute left-0 right-0 border-b border-slate-50"
                      style={{ top: i * ROW_H, height: ROW_H }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-1 min-w-0">
                {weekDays.map((dow, idx) => {
                  const dayLessons = scheduleLessons.filter((l) => l.day === dow);
                  const dayNum = dayLessons[0]?.dayNum ?? 23 + idx;
                  return (
                    <div key={dow} className="flex-1 min-w-0 border-l border-slate-100 first:border-l-0">
                      <div className="sticky top-0 z-[1] flex h-9 sm:h-11 flex-col items-center justify-center border-b border-slate-100 bg-slate-50/95 backdrop-blur-[2px] px-0.5">
                        <div className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                          {days[idx]}
                        </div>
                        <div className="text-xs font-semibold text-slate-800 tabular-nums">{dayNum}</div>
                      </div>
                      <div className="relative bg-white" style={{ height: gridH }}>
                        {Array.from({ length: rowCount }, (_, i) => (
                          <div
                            key={i}
                            className="absolute left-0 right-0 border-b border-slate-50"
                            style={{ top: i * ROW_H, height: ROW_H }}
                          />
                        ))}
                        {dayLessons.map((lesson) => {
                          const top = ((toMin(lesson.start) - rangeStart) / SLOT_MIN) * ROW_H;
                          const height = Math.max(
                            ROW_H,
                            ((toMin(lesson.end) - toMin(lesson.start)) / SLOT_MIN) * ROW_H
                          );
                          const isPersonal = lesson.kind === "personal";
                          return (
                            <div
                              key={`${lesson.start}-${lesson.title}`}
                              className={`absolute left-0.5 right-0.5 overflow-hidden rounded-md border px-1 py-0.5 text-[10px] leading-tight font-semibold text-white shadow-xs ${
                                isPersonal
                                  ? "border-sky-700 bg-sky-500"
                                  : "border-indigo-700 bg-indigo-600"
                              }`}
                              style={{ top, height, zIndex: 1 }}
                            >
                              <span className="block truncate">{lesson.title}</span>
                              {height >= ROW_H * 2 && (
                                <span className="block truncate opacity-80 font-normal">{lesson.subtitle}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
