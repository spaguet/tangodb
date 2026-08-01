import { controlHeightCls } from "./AppSelect";

/**
 * Shared button classes — heights match fieldCls (h-8).
 * See `.cursor/docs/ai/design_system.md` → «Кнопки».
 */

export const btnBaseCls =
  `inline-flex items-center justify-center gap-1.5 ${controlHeightCls} box-border px-3 rounded-lg text-xs font-semibold font-sans transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0`;

/** Добавление / создание / сохранение — indigo filled, регистр предложения (без uppercase). */
export const btnAddCls =
  `${btnBaseCls} bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs`;

/** Добавление — мягкий вариант (заголовок секции, вторичное создание). */
export const btnAddSoftCls =
  `${btnBaseCls} text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100`;

/** Открытие popup / страницы / окна — outline indigo, UPPERCASE. */
export const btnOpenCls =
  `${btnBaseCls} text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 uppercase tracking-wider`;

/** Удаление и предупреждающие действия — rose, UPPERCASE. */
export const btnDestructiveCls =
  `${btnBaseCls} bg-rose-600 hover:bg-rose-700 text-white uppercase tracking-wider`;

/** Обновить / отмена — slate, UPPERCASE. */
export const btnRefreshCls =
  `${btnBaseCls} bg-slate-100 hover:bg-slate-200 text-slate-700 uppercase tracking-wider`;

export const btnCancelCls = btnRefreshCls;

/** Текстовая ссылка «+ Добавить» внутри формы. */
export const btnAddLinkCls =
  "text-xs font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer";
