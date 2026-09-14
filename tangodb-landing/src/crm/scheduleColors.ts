/** Mirrors tangodb/src/lib/scheduleColors.ts — schedule lesson block colors. */

const SCHEDULE_ACCENT_BAR =
  "before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:rounded-l-[4px]" as const;

export const GROUP_LESSON_COLOR = {
  bg: "bg-lesson-group-bg",
  border: "border-lesson-group-border",
  text: "text-lesson-group-text",
  accent: `${SCHEDULE_ACCENT_BAR} before:bg-lesson-group-accent`,
} as const;

export const PERSONAL_LESSON_COLOR = {
  bg: "bg-lesson-personal-bg",
  border: "border-lesson-personal-border",
  text: "text-lesson-personal-text",
  accent: `${SCHEDULE_ACCENT_BAR} before:bg-lesson-personal-accent`,
} as const;
