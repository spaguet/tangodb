import type { KeyboardEvent } from "react";
import { Building2, CalendarPlus, User, Users } from "lucide-react";
import type { DisplayLesson } from "../../types";
import { GROUP_LESSON_COLOR, PERSONAL_LESSON_COLOR, EVENT_LESSON_COLOR, RENTAL_LESSON_COLOR } from "../../lib/scheduleColors";
import { isPastDate } from "../../lib/scheduleWeek";
import { rentalRemainingAmount } from "../../lib/rentalAmount";
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
  const personalDebt = lesson.kind === "personal" && lesson.paid === "no";
  const rentalRemaining =
    lesson.kind === "rental"
      ? rentalRemainingAmount(lesson.fixedAmount, lesson.paidAmount)
      : 0;
  const rentalDebt =
    lesson.kind === "rental" &&
    lesson.bookingStatus === "confirmed" &&
    (lesson.paymentStatus === "unpaid" || lesson.paymentStatus === "partial") &&
    rentalRemaining > 0;
  const hasDebt = personalDebt || rentalDebt;

  const colors =
    lesson.kind === "rental"
      ? RENTAL_LESSON_COLOR
      : lesson.kind === "event"
        ? EVENT_LESSON_COLOR
        : lesson.kind === "personal"
          ? PERSONAL_LESSON_COLOR
          : GROUP_LESSON_COLOR;

  const topPx = lessonTopPx(lesson.timeStart, rangeStartMin);
  const heightPx = lessonHeightPx(lesson.timeStart, lesson.timeEnd);
  const widthPct = 100 / columnCount;
  const leftPct = column * widthPct;

  const showSubtitle = heightPx >= ROW_HEIGHT_PX * 2 && subtitle;
  const showIcon = heightPx >= ROW_HEIGHT_PX;

  const LessonIcon =
    lesson.kind === "rental"
      ? Building2
      : lesson.kind === "event"
        ? CalendarPlus
        : lesson.kind === "personal"
          ? User
          : Users;

  const handleClick = () => onClick?.(lesson);
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? handleClick : undefined}
      onKeyDown={onClick ? handleKeyDown : undefined}
      className={`absolute overflow-hidden rounded-md border px-1 py-0.5 text-[10px] leading-tight font-semibold shadow-xs transition-opacity ${
        onClick ? "cursor-pointer hover:brightness-95" : ""
      } ${isPast ? "opacity-50 grayscale" : ""} ${colors.bg} ${colors.text} ${
        highlighted
          ? "ring-2 ring-gold-600 ring-offset-1"
          : hasDebt
            ? "ring-2 ring-garnet-500 ring-inset"
            : colors.border
      }`}
      style={{
        top: topPx,
        height: heightPx,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        zIndex: highlighted ? 8 : column + 1,
      }}
      title={`${title}${subtitle ? ` · ${subtitle}` : ""}`}
    >
      {showIcon ? (
        <span className="flex min-w-0 items-center gap-0.5">
          <LessonIcon className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{title}</span>
        </span>
      ) : (
        <span className="block truncate">{title}</span>
      )}
      {showSubtitle ? <span className="block truncate opacity-80 font-normal">{subtitle}</span> : null}
    </div>
  );
}
