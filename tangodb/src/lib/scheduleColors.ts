/** Shared left accent stripe for schedule lesson blocks */
const SCHEDULE_ACCENT_BAR =
  "before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:rounded-l-[4px]" as const;

/** Group lessons — neutral pastel */
export const GROUP_LESSON_COLOR = {
  bg: "bg-lesson-group-bg",
  border: "border-lesson-group-border",
  text: "text-lesson-group-text",
  accent: `${SCHEDULE_ACCENT_BAR} before:bg-lesson-group-accent`,
} as const;

/** Personal lessons — indigo pastel */
export const PERSONAL_LESSON_COLOR = {
  bg: "bg-lesson-personal-bg",
  border: "border-lesson-personal-border",
  text: "text-lesson-personal-text",
  accent: `${SCHEDULE_ACCENT_BAR} before:bg-lesson-personal-accent`,
} as const;

/** Calendar events (master class / open lesson) — custom violet hex */
export const EVENT_LESSON_COLOR = {
  bg: "bg-lesson-event-bg",
  border: "border-lesson-event-border",
  text: "text-lesson-event-text",
  accent: `${SCHEDULE_ACCENT_BAR} before:bg-lesson-event-accent`,
} as const;

/** Hall rentals — slate (unchanged solid style) */
export const RENTAL_LESSON_COLOR = {
  bg: "bg-slate-600",
  border: "border-slate-700",
  text: "text-white",
  accent: "",
} as const;

/** Debt / conflict overlay on schedule blocks */
export const SCHEDULE_DEBT_COLOR = {
  bg: "bg-lesson-conflict-bg",
  border: "border-lesson-conflict-border",
  text: "text-lesson-conflict-text",
  accent: `${SCHEDULE_ACCENT_BAR} before:bg-lesson-conflict-accent`,
  ring: "ring-2 ring-lesson-conflict-accent ring-inset",
} as const;
