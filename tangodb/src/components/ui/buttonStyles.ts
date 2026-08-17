import { controlHeightCls } from "./AppSelect";

/**
 * Shared button classes — heights match fieldCls (h-8).
 * See `.cursor/docs/ai/design_system.md` → «Кнопки».
 */

export const btnBaseCls =
  `inline-flex items-center justify-center gap-1.5 ${controlHeightCls} box-border px-3 rounded-lg text-xs font-semibold font-sans transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shrink-0`;

/** Добавление / создание / сохранение — indigo filled, регистр предложения (без uppercase). */
export const btnAddCls =
  `${btnBaseCls} bg-gold-700 hover:bg-gold-800 text-white shadow-xs`;

/** Добавление — мягкий вариант (заголовок секции, вторичное создание). */
export const btnAddSoftCls =
  `${btnBaseCls} text-gold-700 bg-gold-50 border border-gold-100 hover:bg-gold-100`;

/** Открытие popup / страницы / окна — outline indigo, регистр предложения (без uppercase). */
export const btnOpenCls =
  `${btnBaseCls} text-gold-700 bg-gold-50 hover:bg-gold-100 border border-gold-200`;

/** Удаление и предупреждающие действия — rose, UPPERCASE. */
export const btnDestructiveCls =
  `${btnBaseCls} bg-garnet-600 hover:bg-garnet-700 text-white uppercase tracking-wider`;

/** Обновить / отмена — slate, UPPERCASE. */
export const btnRefreshCls =
  `${btnBaseCls} bg-ink-100 hover:bg-ink-200 text-ink-700 uppercase tracking-wider`;

export const btnCancelCls = btnRefreshCls;

/** Header support links (Email, Telegram, WhatsApp) — outline, h-8 like sign out. */
export const btnHeaderContactCls =
  `${btnBaseCls} border border-ink-200 bg-white text-ink-700 font-medium hover:border-gold-200 hover:text-gold-800`;

/** Header sign out — outline slate, h-8. */
export const btnHeaderSignOutCls =
  `${btnBaseCls} text-ink-500 hover:text-ink-800 border border-ink-200 hover:bg-ink-50`;

/** Текстовая ссылка «+ Добавить» внутри формы. */
export const btnAddLinkCls =
  "text-xs font-semibold text-gold-700 hover:text-gold-800 cursor-pointer";
