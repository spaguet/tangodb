/** Group lessons — primary (gold); dark text on gold-500 for WCAG AA (4.5:1) */
export const GROUP_LESSON_COLOR = {
  bg: "bg-gold-500",
  border: "border-gold-700",
  text: "text-ink-900",
} as const;

/** Personal lessons — secondary accent (lavender); lavender-500 bg for white text AA */
export const PERSONAL_LESSON_COLOR = {
  bg: "bg-lavender-500",
  border: "border-lavender-600",
  text: "text-white",
} as const;

/** Calendar events (master class / open lesson) — secondary accent, darker lavender */
export const EVENT_LESSON_COLOR = {
  bg: "bg-lavender-600",
  border: "border-lavender-700",
  text: "text-white",
} as const;

/** Hall rentals — neutral (ink) */
export const RENTAL_LESSON_COLOR = {
  bg: "bg-ink-600",
  border: "border-ink-700",
  text: "text-white",
} as const;
