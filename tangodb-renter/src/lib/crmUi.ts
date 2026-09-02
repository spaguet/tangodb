import type { SlotState } from "./occupancyMerge";

/** CRM-aligned Tailwind classes (tangodb design_system.md). */

export const fieldCls =
  "w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none";

export const labelCls = "text-[10px] text-slate-400 uppercase tracking-wider font-semibold";

export const panelCls = "rounded-xl border border-slate-200/90 bg-white shadow-xs";

export const btnPrimaryCls =
  "inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed";

export const btnSecondaryCls =
  "inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60";

export const btnOpenCls =
  "inline-flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100";

export const btnWeekNavCls =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 text-lg disabled:opacity-30 disabled:hover:bg-transparent";

export const weekChipActiveCls = "bg-indigo-600 text-white border border-indigo-600";
export const weekChipCls =
  "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50";

export function occupancyCellClass(state: SlotState, isToday: boolean): string {
  const todayCol = isToday ? "bg-slate-100/80" : "bg-white";
  switch (state) {
    case "free":
      return `${todayCol} hover:bg-indigo-50/60 active:bg-indigo-100/50`;
    case "busy":
      return "bg-slate-200/90";
    case "mine":
      return "bg-slate-600 text-white ring-1 ring-inset ring-slate-700/40";
    case "mine_hold":
      return "slot-hold text-white";
    default:
      return todayCol;
  }
}
