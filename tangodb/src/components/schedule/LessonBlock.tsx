import type { DisplayLesson } from "../../types";
import { getDisciplineColor, PERSONAL_LESSON_COLOR } from "../../lib/scheduleColors";
import { isPastDate } from "../../lib/scheduleWeek";
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
}

export default function LessonBlock({ item, rangeStartMin, title, subtitle }: LessonBlockProps) {
  const { lesson, column, columnCount } = item;
  const isPast = isPastDate(lesson.date);
  const hasDebt = lesson.kind === "personal" && lesson.paid === "no";

  const colors =
    lesson.kind === "personal"
      ? PERSONAL_LESSON_COLOR
      : getDisciplineColor(lesson.disciplineId);

  const topPx = lessonTopPx(lesson.timeStart, rangeStartMin);
  const heightPx = lessonHeightPx(lesson.timeStart, lesson.timeEnd);
  const widthPct = 100 / columnCount;
  const leftPct = column * widthPct;

  const showSubtitle = heightPx >= ROW_HEIGHT_PX * 2 && subtitle;

  return (
    <div
      className={`absolute overflow-hidden rounded-md border px-1 py-0.5 text-[10px] leading-tight font-semibold shadow-xs transition-opacity ${
        isPast ? "opacity-50 grayscale" : ""
      } ${colors.bg} ${colors.text} ${hasDebt ? "ring-2 ring-rose-500 ring-inset" : colors.border}`}
      style={{
        top: topPx,
        height: heightPx,
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        zIndex: column + 1,
      }}
      title={`${title}${subtitle ? ` · ${subtitle}` : ""}`}
    >
      <span className="block truncate">{title}</span>
      {showSubtitle ? <span className="block truncate opacity-80 font-normal">{subtitle}</span> : null}
    </div>
  );
}
