import { Check, ChevronLeft, ChevronRight, MapPin, Snowflake, X } from "lucide-react";
import type { Locale } from "../../i18n";
import { attendanceStudents } from "../data";
import { crmStrings } from "../strings";

type Props = { locale: Locale };

const statusBtn = {
  present: { icon: Check, cls: "bg-indigo-600 text-white border-indigo-700", labelKey: "present" as const },
  absent: { icon: X, cls: "bg-white text-slate-600 border-slate-200", labelKey: "absent" as const },
  freeze: { icon: Snowflake, cls: "bg-sky-50 text-sky-700 border-sky-200", labelKey: "freeze" as const },
};

export function AttendancePanel({ locale }: Props) {
  const s = crmStrings(locale);

  return (
    <div id="panel-attendance" className="panel-page-stack demo-field-disabled">
      <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 space-y-1.5">
        <p className="text-[10px] font-sans font-semibold uppercase tracking-wider text-slate-500">{s.attendance.legend}</p>
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
          <span>
            <span className="font-semibold text-slate-700">{s.attendance.present}</span> — ✓
          </span>
          <span>
            <span className="font-semibold text-slate-700">{s.attendance.absent}</span> — ✗
          </span>
          <span>
            <span className="font-semibold text-slate-700">{s.attendance.freeze}</span> — ❄
          </span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <button type="button" className="p-1 rounded-lg text-slate-500" aria-label="Prev month">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">June 2026</span>
            <button type="button" className="p-1 rounded-lg text-slate-500" aria-label="Next month">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500">
            <MapPin className="w-3.5 h-3.5 text-indigo-500" />
            {s.attendance.location}
          </div>
        </div>

        <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2">
          <p className="text-xs font-semibold text-indigo-800">
            {locale === "ru" ? "30 июня (Пн) · 18:00" : "Jun 30 (Mon) · 18:00"} — Salsa
          </p>
          <p className="text-[10px] text-indigo-600/80">Maria López · Hall A</p>
        </div>

        <div className="space-y-2">
          {attendanceStudents.map((student) => {
            return (
              <div
                key={student.name}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-50 rounded-xl border border-slate-100"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">{student.name}</p>
                  <p className="text-[10px] text-slate-400 font-sans">{student.sub}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  {(["present", "absent", "freeze"] as const).map((st) => {
                    const c = statusBtn[st];
                    const StIcon = c.icon;
                    const active = st === student.status;
                    return (
                      <button
                        key={st}
                        type="button"
                        disabled
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[10px] font-semibold ${
                          active ? c.cls : "bg-white text-slate-400 border-slate-200 opacity-60"
                        }`}
                      >
                        <StIcon className="w-3 h-3" />
                        {s.attendance[c.labelKey]}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
