import { fieldCls, labelCls } from "../../lib/crmUi";
import { slotEndOptions, slotStartOptions } from "../../lib/grid";
import { fallbackEnd, type PackDayTimes } from "../../lib/packDaySlots";
import { t, WEEKDAY_LABELS, type Locale } from "../../i18n/strings";

type PackDayHoursFieldsProps = {
  locale: Locale;
  weekdays: number[];
  timesByDay: Record<number, PackDayTimes>;
  onChange: (weekday: number, next: PackDayTimes) => void;
};

const starts = slotStartOptions();

export default function PackDayHoursFields({
  locale,
  weekdays,
  timesByDay,
  onChange,
}: PackDayHoursFieldsProps) {
  if (weekdays.length === 0) return null;

  return (
    <div className="space-y-2">
      <span className={labelCls}>{t(locale, "dayHours")}</span>
      {weekdays.map((d) => {
        const slot = timesByDay[d];
        const timeStart = slot?.timeStart ?? "18:00";
        const timeEnd = slot?.timeEnd ?? fallbackEnd(timeStart);
        const ends = slotEndOptions(timeStart);
        const dayLabel = t(locale, WEEKDAY_LABELS[d]);
        return (
          <div key={d} className="grid grid-cols-[2.5rem_1fr_1fr] items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">{dayLabel}</span>
            <label className="flex min-w-0 flex-col gap-0.5">
              <span className="sr-only">
                {dayLabel} · {t(locale, "startTime")}
              </span>
              <select
                className={fieldCls}
                aria-label={`${dayLabel} · ${t(locale, "startTime")}`}
                value={timeStart}
                onChange={(e) => {
                  const nextStart = e.target.value;
                  onChange(d, { timeStart: nextStart, timeEnd: fallbackEnd(nextStart, timeEnd) });
                }}
              >
                {starts.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-0.5">
              <span className="sr-only">
                {dayLabel} · {t(locale, "endTime")}
              </span>
              <select
                className={fieldCls}
                aria-label={`${dayLabel} · ${t(locale, "endTime")}`}
                value={ends.includes(timeEnd) ? timeEnd : (ends[0] ?? "")}
                onChange={(e) => onChange(d, { timeStart, timeEnd: e.target.value })}
              >
                {ends.map((te) => (
                  <option key={te} value={te}>
                    {te}
                  </option>
                ))}
              </select>
            </label>
          </div>
        );
      })}
    </div>
  );
}
