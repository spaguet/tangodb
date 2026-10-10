import type { KeyboardEvent } from "react";
import type { DisplayLesson } from "../../types";
import {
  GROUP_LESSON_COLOR,
  PERSONAL_LESSON_COLOR,
  EVENT_LESSON_COLOR,
  RENTAL_LESSON_COLOR,
  SCHEDULE_DEBT_COLOR,
} from "../../lib/scheduleColors";
import { rentalRemainingAmount } from "../../lib/rentalAmount";
import { isPastDate } from "../../lib/scheduleWeek";
import { personalLessonHasScheduleDebt } from "../../lib/personalLessonPayment";
import {
  lessonHeightPx,
  lessonTopPx,
  ROW_HEIGHT_PX,
  type PositionedLesson,
} from "../../lib/scheduleLayout";

interface LessonBlockProps {
  item: PositionedLesson;
  rangeStartMin: number;
  title: string;
  subtitle?: string;
  onClick?: (lesson: DisplayLesson) => void;
  highlighted?: boolean;
}

export default function LessonBlock({ item, rangeStartMin, title, subtitle, onClick, highlighted = false }: LessonBlockProps) {
  const { lesson, column, columnCount } = item;
  const isPast = isPastDate(lesson.date);
  const personalDebt = lesson.kind === "personal" && personalLessonHasScheduleDebt(lesson);
  const rentalDebt =
    lesson.kind === "rental" &&
    lesson.bookingStatus !== "cancelled" &&
    (lesson.paymentStatus === "unpaid" || lesson.paymentStatus === "partial") &&
    rentalRemainingAmount(lesson.fixedAmount, lesson.paidAmount) > 0;
  const hasDebt = personalDebt || rentalDebt;
  const teacherMasked = lesson.scheduleRestricted === true;
  const editionOccupancy = lesson.editionOccupancy === true;
  const grayChip = teacherMasked || editionOccupancy;

  const baseColors = grayChip
    ? { bg: "bg-slate-200", text: "text-slate-600", accent: "", border: "border-slate-300", ring: "" }
    : lesson.kind === "rental"
      ? RENTAL_LESSON_COLOR
      : lesson.kind === "event"
        ? EVENT_LESSON_COLOR
        : lesson.kind === "personal"
          ? PERSONAL_LESSON_COLOR
          : GROUP_LESSON_COLOR;

  const colors = grayChip ? baseColors : hasDebt ? SCHEDULE_DEBT_COLOR : baseColors;

  const topPx = lessonTopPx(lesson.timeStart, rangeStartMin);
  const heightPx = lessonHeightPx(lesson.timeStart, lesson.timeEnd);
  const widthPct = 100 / columnCount;
  const leftPct = column * widthPct;

  const showSubtitle = !teacherMasked && heightPx >= ROW_HEIGHT_PX * 2 && subtitle;

  const clickable = onClick && !teacherMasked;
  const handleClick = () => {
    if (!clickable) return;
    onClick?.(lesson);
  };
  const handleKeyDown = (e: KeyboardEvent) => {
    if (!clickable) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  const borderClass = grayChip
    ? "border-slate-300"
    : highlighted
    ? "ring-2 ring-indigo-600 ring-offset-1"
    : hasDebt
      ? SCHEDULE_DEBT_COLOR.ring
      : colors.border;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? handleClick : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
      className={`absolute overflow-hidden rounded-md border px-1 py-0.5 text-[10px] leading-tight font-semibold shadow-xs transition-opacity ${
        clickable ? "cursor-pointer hover:brightness-95" : grayChip ? "cursor-default" : ""
      } ${grayChip ? "" : isPast ? "opacity-50 grayscale" : ""} ${colors.bg} ${colors.text} ${colors.accent} ${borderClass}`}
      style={{
        top: topPx,
        height: heightPx,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        zIndex: highlighted ? 8 : column + 1,
      }}
      title={`${title}${subtitle ? ` · ${subtitle}` : ""}`}
    >
      <span className="block truncate">{title}</span>
      {showSubtitle ? <span className="block truncate opacity-80 font-normal">{subtitle}</span> : null}
    </div>
  );
}
