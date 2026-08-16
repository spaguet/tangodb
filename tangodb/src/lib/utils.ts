import type { PriceCategory } from "../types";
import { t, resolveLocale } from "./i18n";
import type { I18nKey } from "./i18n/keys";

const DOW_SHORT_KEYS: Record<number, I18nKey> = {
  1: "utils.dow.short.mon",
  2: "utils.dow.short.tue",
  3: "utils.dow.short.wed",
  4: "utils.dow.short.thu",
  5: "utils.dow.short.fri",
  6: "utils.dow.short.sat",
  7: "utils.dow.short.sun",
};

const DOW_FULL_KEYS: Record<number, I18nKey> = {
  1: "utils.dow.full.mon",
  2: "utils.dow.full.tue",
  3: "utils.dow.full.wed",
  4: "utils.dow.full.thu",
  5: "utils.dow.full.fri",
  6: "utils.dow.full.sat",
  7: "utils.dow.full.sun",
};

export type TranslateFn = (key: I18nKey, params?: Record<string, string | number>) => string;

export function getDowLabels(locale?: string | null): Record<number, string> {
  return Object.fromEntries(ISO_DOW_RANGE.map((d) => [d, t(locale, DOW_SHORT_KEYS[d])]));
}

export function getDowFullLabels(locale?: string | null): Record<number, string> {
  return Object.fromEntries(ISO_DOW_RANGE.map((d) => [d, t(locale, DOW_FULL_KEYS[d])]));
}

/** ISO day-of-week: 1 = Monday … 7 = Sunday */
export const ISO_DOW_RANGE = [1, 2, 3, 4, 5, 6, 7] as const;

/** Convert JS Date.getDay() (0 = Sun) to ISO (1 = Mon … 7 = Sun) */
export function jsDayToIsoDow(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

/** HH:MM intervals overlap (end exclusive at boundary: 14:00–15:00 vs 15:00–16:00 — no conflict) */
export function timesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  return start1 < end2 && start2 < end1;
}

function conflictMessage(
  key: I18nKey,
  translate?: TranslateFn,
  locale?: string | null
): string {
  if (translate) return translate(key);
  return t(locale, key);
}

export function findPersonalLessonBookingConflict(
  date: string,
  timeStart: string,
  timeEnd: string,
  personalLessons: Array<{ id: string; date: string; timeStart: string; timeEnd: string }>,
  excludeLessonId?: string,
  translate?: TranslateFn,
  locale?: string | null
): string | null {
  for (const lesson of personalLessons) {
    if (excludeLessonId && lesson.id === excludeLessonId) continue;
    if (lesson.date !== date) continue;
    const lessonEnd = lesson.timeEnd || lesson.timeStart;
    if (timesOverlap(timeStart, timeEnd, lesson.timeStart, lessonEnd)) {
      return conflictMessage("utils.conflict.personalLesson", translate, locale);
    }
  }
  return null;
}

export function findGroupScheduleConflictOnDate(
  date: string,
  timeStart: string,
  timeEnd: string,
  schedule: Array<{ dayOfWeek: number; time: string; timeEnd: string }>,
  translate?: TranslateFn,
  locale?: string | null
): string | null {
  const dow = jsDayToIsoDow(new Date(date + "T12:00:00").getDay());
  for (const slot of schedule) {
    if (slot.dayOfWeek !== dow) continue;
    if (!timesOverlap(timeStart, timeEnd, slot.time, slot.timeEnd || "21:00")) continue;
    return conflictMessage("utils.conflict.groupLesson", translate, locale);
  }
  return null;
}

export function findBookingScheduleConflict(
  date: string,
  timeStart: string,
  timeEnd: string,
  personalLessons: Array<{ id: string; date: string; timeStart: string; timeEnd: string }>,
  schedule: Array<{ dayOfWeek: number; time: string; timeEnd: string }>,
  excludeLessonId?: string,
  translate?: TranslateFn,
  locale?: string | null
): string | null {
  return (
    findPersonalLessonBookingConflict(date, timeStart, timeEnd, personalLessons, excludeLessonId, translate, locale) ??
    findGroupScheduleConflictOnDate(date, timeStart, timeEnd, schedule, translate, locale)
  );
}

export { formatCurrencyActive as formatCurrency } from "./format";

export function formatClientName(lastName: string, firstName: string): string {
  return `${lastName} ${firstName}`.trim();
}

/** «June 2026» / «Июнь 2026 г.» — month capitalized; Russian adds «г.» */
export function formatMonthTitle(yearMonth: string, locale?: string | null): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  const date = new Date(y, m - 1, 1);
  const code = resolveLocale(locale);
  const month = new Intl.DateTimeFormat(code, { month: "long" }).format(date);
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  if (code === "ru-RU") return `${monthCap} ${y}\u00A0г.`;
  return `${monthCap} ${y}`;
}

/** @deprecated Use formatMonthTitle(yearMonth, locale) */
export function formatMonthTitleRu(yearMonth: string): string {
  return formatMonthTitle(yearMonth, "ru-RU");
}

export function getPersonalLessonTariffLabel(
  lesson: { type: string; price: number; subscriptionId?: string | null },
  prices: PriceTariffRef[],
  subscriptions: Array<{ id: string; priceId?: string | null; type: string; lessonsTotal: number; pairMonth: string }> = [],
  translate?: TranslateFn,
  locale?: string | null
): string {
  if (lesson.subscriptionId) {
    const sub = subscriptions.find((s) => s.id === lesson.subscriptionId);
    if (sub) return getSubscriptionTariffLabel(sub, prices, translate, locale);
  }

  const personalType = `personal_${lesson.type}`;
  const byPrice = prices.find(
    (p) =>
      getPriceCategory(p) === "private" &&
      p.lessons === 1 &&
      p.type.trim() === personalType &&
      p.price === lesson.price
  );
  if (byPrice) return getPriceLabel(byPrice, translate, locale);

  const byType = prices.find((p) => p.type.trim() === personalType);
  if (byType) return getPriceLabel(byType, translate, locale);

  const catalogKey = PRICE_CATALOG_KEYS[personalType]?.labelKey;
  if (catalogKey) return translate ? translate(catalogKey) : t(locale, catalogKey);

  if (lesson.type === "pair") return translate ? translate("utils.tariff.personal_pair.label") : t(locale, "utils.tariff.personal_pair.label");
  if (lesson.type === "trio") return translate ? translate("utils.tariff.personal_trio.label") : t(locale, "utils.tariff.personal_trio.label");
  return translate ? translate("utils.tariff.personal_solo.label") : t(locale, "utils.tariff.personal_solo.label");
}

export function formatPairName(
  lastName1: string,
  firstName1: string,
  lastName2: string,
  firstName2: string
): string {
  return `${formatClientName(lastName1, firstName1)} & ${formatClientName(lastName2, firstName2)}`;
}

/** @deprecated Use getDowLabels(locale)[dayOfWeek] */
export function dowShort(dayOfWeek: number, locale?: string | null): string {
  return getDowLabels(locale)[dayOfWeek] ?? String(dayOfWeek);
}

/** @deprecated Use getDowFullLabels(locale)[dayOfWeek] */
export function dowFull(dayOfWeek: number, locale?: string | null): string {
  return getDowFullLabels(locale)[dayOfWeek] ?? String(dayOfWeek);
}

export function dowFullEntries(locale?: string | null): [number, string][] {
  const labels = getDowFullLabels(locale);
  return ISO_DOW_RANGE.map((d) => [d, labels[d]]);
}

/** Russian plural form: pluralizeRu(3, ["гость", "гостя", "гостей"]) → "гостя" */
export function pluralizeRu(n: number, forms: [string, string, string]): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return forms[2];
  if (last === 1) return forms[0];
  if (last >= 2 && last <= 4) return forms[1];
  return forms[2];
}

export function formatDayMonthRu(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
  }).format(new Date(y, m - 1, d));
}

export function formatDateRu(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

export function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function currentYear(): number {
  return new Date().getFullYear();
}

export function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function isDateInYear(dateStr: string, year: number): boolean {
  const y = Number(dateStr.slice(0, 4));
  return y === year;
}

export function isDateInYearMonth(dateStr: string, yearMonth: string): boolean {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return key === yearMonth;
}

export interface PriceTariffRef {
  id?: string;
  type: string;
  lessons: number;
  price: number;
  label?: string;
  description?: string;
  category?: PriceCategory;
  locationId?: string | null;
  disciplineId?: string | null;
  disciplineIds?: string[];
  teacherMemberIds?: string[];
  billingModel?: import("../types").BillingModel;
}

type PriceCatalogMeta = { labelKey: I18nKey; subKey: I18nKey; col: string };

export const PRICE_CATALOG_KEYS: Record<string, PriceCatalogMeta> = {
  solo: { labelKey: "utils.tariff.solo.label", subKey: "utils.tariff.solo.sub", col: "group" },
  solo_8: { labelKey: "utils.tariff.solo_8.label", subKey: "utils.tariff.solo_8.sub", col: "group" },
  pair_hm: { labelKey: "utils.tariff.pair_hm.label", subKey: "utils.tariff.pair_hm.sub", col: "group" },
  pair_m1: { labelKey: "utils.tariff.pair_m1.label", subKey: "utils.tariff.pair_m1.sub", col: "group" },
  pair_m2: { labelKey: "utils.tariff.pair_m2.label", subKey: "utils.tariff.pair_m2.sub", col: "group" },
  pair_m3: { labelKey: "utils.tariff.pair_m3.label", subKey: "utils.tariff.pair_m3.sub", col: "group" },
  monthly_unlimited: {
    labelKey: "utils.tariff.monthly_unlimited.label",
    subKey: "utils.tariff.monthly_unlimited.sub",
    col: "group",
  },
  personal_solo: { labelKey: "utils.tariff.personal_solo.label", subKey: "utils.tariff.personal_solo.sub", col: "private" },
  personal_pair: { labelKey: "utils.tariff.personal_pair.label", subKey: "utils.tariff.personal_pair.sub", col: "private" },
  personal_trio: { labelKey: "utils.tariff.personal_trio.label", subKey: "utils.tariff.personal_trio.sub", col: "private" },
  personal_quad: { labelKey: "utils.tariff.personal_quad.label", subKey: "utils.tariff.personal_quad.sub", col: "private" },
  single_visit: { labelKey: "utils.tariff.single_visit.label", subKey: "utils.tariff.single_visit.sub", col: "single_visit" },
};

/** @deprecated Use PRICE_CATALOG_KEYS with getPriceLabel(price, translate, locale) */
export const PRICE_LABELS_CATALOG: Record<string, { label: string; sub: string; col: string }> = Object.fromEntries(
  Object.entries(PRICE_CATALOG_KEYS).map(([key, meta]) => [
    key,
    { label: t("ru-RU", meta.labelKey), sub: t("ru-RU", meta.subKey), col: meta.col },
  ])
);

export interface SubscriptionTariffRef {
  type: string;
  lessonsTotal: number;
  pairMonth: string;
  priceId?: string | null;
  billingModel?: import("../types").BillingModel;
  expiresAt?: string | null;
}

export function getPriceCatalogKey(price: Pick<PriceTariffRef, "type"> & Partial<Pick<PriceTariffRef, "lessons">>): string {
  let lookupKey = price.type.trim();
  if (lookupKey === "solo" && price.lessons === 8) lookupKey = "solo_8";
  return lookupKey;
}

export function getPriceCategory(
  price: Pick<PriceTariffRef, "type"> & Partial<Pick<PriceTariffRef, "category" | "lessons">>
): PriceCategory {
  if (price.category === "group" || price.category === "private" || price.category === "single_visit") {
    return price.category;
  }
  const catalogCol = PRICE_CATALOG_KEYS[getPriceCatalogKey(price)]?.col;
  if (catalogCol === "private") return "private";
  if (catalogCol === "single_visit") return "single_visit";
  return "group";
}

export function generateTariffTypeKey(): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `tariff_${id}`;
}

export function getPriceLabel(
  price: PriceTariffRef,
  translate?: TranslateFn,
  locale?: string | null
): string {
  if (price.label?.trim()) return price.label.trim();
  const meta = PRICE_CATALOG_KEYS[getPriceCatalogKey(price)];
  if (meta) return translate ? translate(meta.labelKey) : t(locale, meta.labelKey);
  return price.type;
}

type LabelScriptGroup = "cyrillic" | "latin" | "digit" | "other";

const CYRILLIC_FIRST_RE = /[\u0400-\u04FF]/;
const LATIN_FIRST_RE = /[A-Za-z]/;
const DIGIT_FIRST_RE = /\d/;

const LABEL_SCRIPT_GROUP_ORDER: Record<LabelScriptGroup, number> = {
  cyrillic: 0,
  latin: 1,
  digit: 2,
  other: 3,
};

function getLabelScriptGroup(label: string): LabelScriptGroup {
  const trimmed = label.trim();
  if (!trimmed) return "other";
  const ch = trimmed[0]!;
  if (CYRILLIC_FIRST_RE.test(ch)) return "cyrillic";
  if (LATIN_FIRST_RE.test(ch)) return "latin";
  if (DIGIT_FIRST_RE.test(ch)) return "digit";
  return "other";
}

/** Sort labels: Cyrillic А–Я, then Latin A–Z, then digits, then other. */
export function compareLabelsCyrillicFirst(a: string, b: string): number {
  const groupDiff =
    LABEL_SCRIPT_GROUP_ORDER[getLabelScriptGroup(a)] -
    LABEL_SCRIPT_GROUP_ORDER[getLabelScriptGroup(b)];
  if (groupDiff !== 0) return groupDiff;

  const group = getLabelScriptGroup(a);
  if (group === "cyrillic") return a.localeCompare(b, "ru", { sensitivity: "base" });
  if (group === "latin") return a.localeCompare(b, "en", { sensitivity: "base" });
  if (group === "digit") return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

export function sortPricesByLabel<T extends PriceTariffRef>(
  prices: T[],
  translate?: TranslateFn,
  locale?: string | null
): T[] {
  return [...prices].sort((a, b) =>
    compareLabelsCyrillicFirst(
      getPriceLabel(a, translate, locale),
      getPriceLabel(b, translate, locale)
    )
  );
}

export function getPriceDescription(
  price: PriceTariffRef,
  translate?: TranslateFn,
  locale?: string | null
): string {
  if (price.description?.trim()) return price.description.trim();
  const meta = PRICE_CATALOG_KEYS[getPriceCatalogKey(price)];
  if (meta) return translate ? translate(meta.subKey) : t(locale, meta.subKey);
  return translate
    ? translate("utils.tariff.lessonsCount", { count: price.lessons })
    : t(locale, "utils.tariff.lessonsCount", { count: price.lessons });
}

export function getGroupTariffs<T extends PriceTariffRef>(prices: T[]): T[] {
  return prices.filter((p) => getPriceCategory(p) === "group");
}

export function isGlobalLocationTariff(price: Pick<PriceTariffRef, "locationId">): boolean {
  return !price.locationId;
}

/** @deprecated Use isGlobalLocationTariff */
export function isGlobalTariff(price: Pick<PriceTariffRef, "locationId">): boolean {
  return isGlobalLocationTariff(price);
}

export function getPriceDisciplineIds(
  price: Pick<PriceTariffRef, "disciplineId" | "disciplineIds">
): string[] {
  if (price.disciplineIds && price.disciplineIds.length > 0) return price.disciplineIds;
  if (price.disciplineId) return [price.disciplineId];
  return [];
}

export function isGlobalDisciplineTariff(
  price: Pick<PriceTariffRef, "disciplineId" | "disciplineIds">
): boolean {
  return getPriceDisciplineIds(price).length === 0;
}

export function isFullyGlobalTariff(
  price: Pick<PriceTariffRef, "locationId" | "disciplineId" | "disciplineIds">
): boolean {
  return isGlobalLocationTariff(price) && isGlobalDisciplineTariff(price);
}

function matchesLocationBinding<T extends Pick<PriceTariffRef, "locationId">>(
  price: T,
  options: { localPriceList?: boolean; locationId?: string | null }
): boolean {
  if (options.localPriceList === false) {
    return isGlobalLocationTariff(price);
  }
  if (options.localPriceList === true) {
    if (!options.locationId) return false;
    return isGlobalLocationTariff(price) || price.locationId === options.locationId;
  }
  if (options.locationId) {
    return isGlobalLocationTariff(price) || price.locationId === options.locationId;
  }
  return isGlobalLocationTariff(price);
}

function matchesDisciplineBinding<T extends Pick<PriceTariffRef, "disciplineId" | "disciplineIds">>(
  price: T,
  disciplineId?: string | null
): boolean {
  if (!disciplineId) return isGlobalDisciplineTariff(price);
  const boundIds = getPriceDisciplineIds(price);
  if (boundIds.length === 0) return true;
  return boundIds.includes(disciplineId);
}

export function isGlobalTeacherTariff(price: Pick<PriceTariffRef, "teacherMemberIds">): boolean {
  return !price.teacherMemberIds || price.teacherMemberIds.length === 0;
}

function matchesTeacherBinding<T extends Pick<PriceTariffRef, "teacherMemberIds">>(
  price: T,
  teacherMemberId?: string | null
): boolean {
  if (!teacherMemberId) return true;
  if (isGlobalTeacherTariff(price)) return true;
  return price.teacherMemberIds!.includes(teacherMemberId);
}

export function filterTariffsForSale<T extends PriceTariffRef>(
  prices: T[],
  options: {
    localPriceList?: boolean;
    locationId?: string | null;
    disciplineId?: string | null;
    teacherMemberId?: string | null;
  }
): T[] {
  return prices.filter(
    (p) =>
      matchesLocationBinding(p, options) &&
      matchesDisciplineBinding(p, options.disciplineId ?? null) &&
      matchesTeacherBinding(p, options.teacherMemberId ?? null)
  );
}

export function filterGroupTariffsForSale<T extends PriceTariffRef>(
  prices: T[],
  options: {
    localPriceList: boolean;
    locationId?: string | null;
    disciplineId?: string | null;
    teacherMemberId?: string | null;
  }
): T[] {
  return filterTariffsForSale(getGroupTariffs(prices), options);
}

export function filterPrivateLessonTariffsForSale<T extends PriceTariffRef>(
  prices: T[],
  options: {
    locationId?: string | null;
    disciplineId?: string | null;
    teacherMemberId?: string | null;
  }
): T[] {
  return filterTariffsForSale(getPrivateLessonTariffs(prices), options);
}

export function filterPrivatePackageTariffsForSale<T extends PriceTariffRef>(
  prices: T[],
  options: { locationId?: string | null; disciplineId?: string | null }
): T[] {
  return filterTariffsForSale(getPrivatePackageTariffs(prices), options);
}

export function filterSingleVisitTariffsForSale<T extends PriceTariffRef>(
  prices: T[],
  options: { locationId?: string | null; disciplineId?: string | null }
): T[] {
  return filterTariffsForSale(getSingleVisitTariffs(prices), options);
}

export function getSingleVisitTariffs<T extends PriceTariffRef>(prices: T[]): T[] {
  return prices.filter((p) => getPriceCategory(p) === "single_visit");
}

export function getPrivatePackageTariffs<T extends PriceTariffRef>(prices: T[]): T[] {
  return prices.filter((p) => getPriceCategory(p) === "private" && p.lessons > 1);
}

export function getPrivateLessonTariffs<T extends PriceTariffRef>(prices: T[]): T[] {
  return prices.filter((p) => getPriceCategory(p) === "private" && p.lessons === 1);
}

export function tariffNeedsSecondClient(tariff: Pick<PriceTariffRef, "type" | "billingModel">): boolean {
  if (isMonthlyUnlimitedTariff(tariff)) return false;
  const t = tariff.type.trim();
  return t === "pair_hm" || t.startsWith("pair_m") || t === "personal_pair" || t === "personal_trio";
}

export function tariffNeedsThirdClient(tariff: Pick<PriceTariffRef, "type">): boolean {
  return tariff.type.trim() === "personal_trio";
}

export function tariffNeedsFourthClient(tariff: Pick<PriceTariffRef, "type">): boolean {
  return tariff.type.trim() === "personal_quad";
}

export function tariffParticipantType(tariff: Pick<PriceTariffRef, "type">): "solo" | "pair" | "trio" | "quad" {
  const t = tariff.type.trim();
  if (t === "personal_pair") return "pair";
  if (t === "personal_trio") return "trio";
  if (t === "personal_quad") return "quad";
  return "solo";
}

const CUSTOM_TARIFF_TYPE_RE = /^tariff_[a-f0-9]{12}$/;

/** DB stores pair_month as m1|m2|m3; normalize legacy "1" → "m1". */
export function normalizeSubscriptionPairMonth(type: string, pairMonth: string): string {
  if (type.trim() !== "pair") return "";
  const pm = pairMonth.trim();
  if (/^m[123]$/.test(pm)) return pm;
  if (/^[123]$/.test(pm)) return `m${pm}`;
  return "m1";
}

export function pairMonthDisplayNumber(pairMonth: string): string {
  const pm = pairMonth.trim();
  const withPrefix = pm.match(/^m([123])$/);
  if (withPrefix) return withPrefix[1];
  if (/^[123]$/.test(pm)) return pm;
  return "1";
}

export function isMonthlyUnlimitedTariff(
  tariff: Pick<PriceTariffRef, "billingModel" | "type">
): boolean {
  return tariff.billingModel === "monthly_unlimited" || tariff.type.trim() === "monthly_unlimited";
}

export function isMonthlyUnlimitedSubscription(
  sub: Pick<SubscriptionTariffRef, "billingModel">
): boolean {
  return sub.billingModel === "monthly_unlimited";
}

export function computeMonthlyExpiresAt(activationDate: string): string {
  const [year, month, day] = activationDate.slice(0, 10).split("-").map(Number);
  const date = new Date(year, month - 1 + 1, day);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getSubscriptionDaysLeft(
  expiresAt: string | null | undefined,
  asOfDate: string = new Date().toISOString().slice(0, 10)
): number {
  if (!expiresAt) return 0;
  const end = new Date(`${expiresAt.slice(0, 10)}T12:00:00`);
  const current = new Date(`${asOfDate.slice(0, 10)}T12:00:00`);
  return Math.max(0, Math.ceil((end.getTime() - current.getTime()) / (24 * 60 * 60 * 1000)));
}

export function subscriptionIsActiveForDate(
  sub: {
    activationDate: string;
    billingModel?: import("../types").BillingModel;
    expiresAt?: string | null;
    lessonsLeft: number;
    status: "active" | "finished";
  },
  dateStr: string
): boolean {
  if (sub.status !== "active" || sub.activationDate > dateStr) return false;
  if (isMonthlyUnlimitedSubscription(sub)) {
    return Boolean(sub.expiresAt && sub.expiresAt >= dateStr);
  }
  return sub.lessonsLeft > 0;
}

export function deriveSubscriptionTypeFromTariff(
  tariff: Pick<PriceTariffRef, "type" | "category" | "billingModel">
): { type: string; pairMonth: string; billingModel: import("../types").BillingModel } {
  if (isMonthlyUnlimitedTariff(tariff)) {
    return { type: "solo", pairMonth: "", billingModel: "monthly_unlimited" };
  }
  const t = tariff.type.trim();
  if (t === "solo") return { type: "solo", pairMonth: "", billingModel: "lesson_count" };
  if (t === "pair_hm") return { type: "pair_hm", pairMonth: "", billingModel: "lesson_count" };
  const pairMonthMatch = t.match(/^pair_m([123])$/);
  if (pairMonthMatch) {
    return { type: "pair", pairMonth: `m${pairMonthMatch[1]}`, billingModel: "lesson_count" };
  }
  if (t.startsWith("personal_")) {
    return { type: t.replace("personal_", ""), pairMonth: "", billingModel: "lesson_count" };
  }
  if (CUSTOM_TARIFF_TYPE_RE.test(t)) {
    const category = getPriceCategory(tariff);
    if (category === "private") return { type: "solo", pairMonth: "", billingModel: "lesson_count" };
    return { type: "solo", pairMonth: "", billingModel: "lesson_count" };
  }
  if (getPriceCategory(tariff) === "group") return { type: "solo", pairMonth: "", billingModel: "lesson_count" };
  if (getPriceCategory(tariff) === "private") return { type: "solo", pairMonth: "", billingModel: "lesson_count" };
  return { type: "solo", pairMonth: "", billingModel: "lesson_count" };
}

export interface SubscriptionClientRef {
  type: string;
  clientId1: string;
  clientId2?: string;
  clientId3?: string;
  clientId4?: string;
}

export function getSubscriptionClientIds(sub: SubscriptionClientRef): string[] {
  const ids = [sub.clientId1];
  if (sub.clientId2) ids.push(sub.clientId2);
  if (sub.clientId3) ids.push(sub.clientId3);
  if (sub.clientId4) ids.push(sub.clientId4);
  return ids;
}

export function bookingClientsMatchSubscription(
  sub: SubscriptionClientRef,
  booking: { clientId1: string; clientId2?: string; clientId3?: string; clientId4?: string }
): boolean {
  const expected = getSubscriptionClientIds(sub);
  const actual = [booking.clientId1, booking.clientId2, booking.clientId3, booking.clientId4].filter(
    Boolean
  ) as string[];
  if (expected.length !== actual.length) return false;
  return expected.every((id, i) => id === actual[i]);
}

export function findSubscriptionPrice(
  sub: SubscriptionTariffRef,
  prices: PriceTariffRef[]
): PriceTariffRef | undefined {
  if (sub.priceId) {
    return prices.find((p) => p.id === sub.priceId);
  }
  if (sub.type === "solo") {
    return prices.find((p) => p.type.trim() === "solo" && p.lessons === sub.lessonsTotal);
  }
  if (sub.lessonsTotal === 4) {
    return prices.find((p) => p.type.trim() === "pair_hm");
  }
  const month = pairMonthDisplayNumber(sub.pairMonth);
  return prices.find((p) => p.type.trim() === `pair_m${month}`);
}

export function getSubscriptionTariffLabel(
  sub: SubscriptionTariffRef,
  prices: PriceTariffRef[],
  translate?: TranslateFn,
  locale?: string | null
): string {
  const matched = findSubscriptionPrice(sub, prices);
  if (matched) return getPriceLabel(matched, translate, locale);
  if (isMonthlyUnlimitedSubscription(sub)) {
    return translate
      ? translate("utils.tariff.subscription.monthlyUnlimited")
      : t(locale, "utils.tariff.subscription.monthlyUnlimited");
  }

  if (sub.type === "solo") {
    return translate ? translate("utils.tariff.subscription.solo") : t(locale, "utils.tariff.subscription.solo");
  }
  if (sub.type === "pair_hm" || sub.type === "pair") {
    return translate
      ? translate("utils.tariff.subscription.pair", { count: sub.lessonsTotal })
      : t(locale, "utils.tariff.subscription.pair", { count: sub.lessonsTotal });
  }
  if (sub.type === "trio") {
    return translate ? translate("utils.tariff.subscription.trio") : t(locale, "utils.tariff.subscription.trio");
  }
  if (sub.type === "quad") {
    return translate ? translate("utils.tariff.subscription.quad") : t(locale, "utils.tariff.subscription.quad");
  }
  return sub.type;
}

export function getSubscriptionPrice(sub: SubscriptionTariffRef, prices: PriceTariffRef[]): number {
  return findSubscriptionPrice(sub, prices)?.price ?? 0;
}
