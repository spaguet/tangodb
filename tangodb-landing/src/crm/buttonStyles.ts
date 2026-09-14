/** Mirrors tangodb/src/components/ui/buttonStyles.ts (demo subset). */

export const btnBaseCls =
  "inline-flex items-center justify-center gap-1.5 h-8 box-border px-3 rounded-lg text-xs font-semibold font-sans transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0";

export const btnAddCls = `${btnBaseCls} bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs`;

export const btnHeaderSignOutCls =
  `${btnBaseCls} text-slate-500 hover:text-slate-800 border border-slate-200 hover:bg-slate-50`;

export const btnDrawerSignOutCls =
  "w-full inline-flex items-center gap-3 h-8 box-border px-3 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed";
