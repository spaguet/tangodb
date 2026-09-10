import type { SlotState } from "./occupancyMerge";

/** CRM-aligned Tailwind classes — Studio Controller palette (`.cursor/docs/ai/crm_color_migration.md`). */

export const fieldCls =
  "w-full h-8 box-border rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-800 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none transition-all";

export const labelCls = "text-[10px] text-slate-400 uppercase tracking-wider font-semibold";

export const panelCls = "rounded-xl border border-slate-200/90 bg-white shadow-xs";

export const btnPrimaryCls =
  "inline-flex h-8 items-center justify-center rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed";

export const btnSecondaryCls =
  "inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60";

export const btnOpenCls =
  "inline-flex h-8 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-xs font-semibold text-indigo-700 hover:bg-indigo-100";

export const btnWeekNavCls =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent";

export const weekChipActiveCls = "bg-indigo-600 text-white border border-indigo-600";
export const weekChipCls = "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50";

export const sectionTitleCls = "text-base font-semibold text-slate-800 tracking-tight";

export const btnDestructiveOpenCls =
  "inline-flex h-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 px-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-60";

export const successBannerCls =
  "rounded-lg border border-green-100 bg-green-50 p-3 text-sm font-medium text-green-700";

const blockBase =
  "absolute overflow-hidden rounded-md border px-1 py-0.5 text-[10px] leading-tight font-semibold shadow-xs";
const accentBar =
  "before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:rounded-l-[4px]";

/** Occupied blocks — CRM LessonBlock tokens (busy = group pastel, mine = rental slate). */
export function occupancyBlockClass(state: Exclude<SlotState, "free">): string {
  switch (state) {
    case "busy":
      return `${blockBase} ${accentBar} bg-lesson-group-bg border-lesson-group-border text-lesson-group-text before:bg-lesson-group-accent`;
    case "mine":
      return `${blockBase} bg-slate-600 border-slate-700 text-white`;
    case "mine_hold":
      return `${blockBase} bg-slate-600 border-slate-700 text-white`;
    case "mine_debt":
      return `${blockBase} ${accentBar} bg-lesson-conflict-bg border-lesson-conflict-border text-lesson-conflict-text before:bg-lesson-conflict-accent ring-2 ring-inset ring-lesson-conflict-accent`;
    default:
      return blockBase;
  }
}

export function occupancyLegendSwatchClass(state: Exclude<SlotState, "free"> | "free"): string {
  switch (state) {
    case "free":
      return "h-2.5 w-2.5 rounded-sm border border-slate-200 bg-white";
    case "busy":
      return "h-2.5 w-2.5 rounded-sm border border-lesson-group-border bg-lesson-group-bg";
    case "mine":
      return "h-2.5 w-2.5 rounded-sm bg-slate-600";
    case "mine_hold":
      return "slot-hold h-2.5 w-2.5 rounded-sm border border-slate-700";
    case "mine_debt":
      return "h-2.5 w-2.5 rounded-sm border border-lesson-conflict-border bg-lesson-conflict-bg";
    default:
      return "h-2.5 w-2.5 rounded-sm border border-slate-200 bg-white";
  }
}
