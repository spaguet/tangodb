import type { PriceCategory } from "../types";

const DOW_LABELS: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Вс",
};

const DOW_FULL: Record<number, string> = {
  1: "Понедельник",
  2: "Вторник",
  3: "Среда",
  4: "Четверг",
  5: "Пятница",
  6: "Суббота",
  7: "Воскресенье",
};

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

export function findPersonalLessonBookingConflict(
  date: string,
  timeStart: string,
  timeEnd: string,
  personalLessons: Array<{ id: string; date: string; timeStart: string; timeEnd: string }>,
  excludeLessonId?: string
): string | null {
  for (const lesson of personalLessons) {
    if (excludeLessonId && lesson.id === excludeLessonId) continue;
    if (lesson.date !== date) continue;
    const lessonEnd = lesson.timeEnd || lesson.timeStart;
    if (timesOverlap(timeStart, timeEnd, lesson.timeStart, lessonEnd)) {
      return "в это время уже записан персональный урок";
    }
  }
  return null;
}

export function findGroupScheduleConflictOnDate(
  date: string,
  timeStart: string,
  timeEnd: string,
  schedule: Array<{ dayOfWeek: number; time: string; timeEnd: string }>
): string | null {
  const dow = jsDayToIsoDow(new Date(date + "T12:00:00").getDay());
  for (const slot of schedule) {
    if (slot.dayOfWeek !== dow) continue;
    if (!timesOverlap(timeStart, timeEnd, slot.time, slot.timeEnd || "21:00")) continue;
    return "в это время уже записан групповой урок";
  }
  return null;
}

export function findBookingScheduleConflict(
  date: string,
  timeStart: string,
  timeEnd: string,
  personalLessons: Array<{ id: string; date: string; timeStart: string; timeEnd: string }>,
  schedule: Array<{ dayOfWeek: number; time: string; timeEnd: string }>,
  excludeLessonId?: string
): string | null {
  return (
    findPersonalLessonBookingConflict(date, timeStart, timeEnd, personalLessons, excludeLessonId) ??
    findGroupScheduleConflictOnDate(date, timeStart, timeEnd, schedule)
  );
}

export { formatCurrencyActive as formatCurrency } from "./format";

export function formatClientName(lastName: string, firstName: string): string {
  return `${lastName} ${firstName}`.trim();
}

/** «Июнь 2026 г.» — месяц с заглавной, «г.» прописными (без CSS capitalize) */
export function formatMonthTitleRu(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  const date = new Date(y, m - 1, 1);
  const month = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(date);
  const monthCap = month.charAt(0).toUpperCase() + month.slice(1);
  return `${monthCap} ${y}\u00A0г.`;
}

export function getPersonalLessonTariffLabel(
  lesson: { type: string; price: number; subscriptionId?: string | null },
  prices: PriceTariffRef[],
  subscriptions: Array<{ id: string; priceId?: string | null; type: string; lessonsTotal: number; pairMonth: string }> = []
): string {
  if (lesson.subscriptionId) {
    const sub = subscriptions.find((s) => s.id === lesson.subscriptionId);
    if (sub) return getSubscriptionTariffLabel(sub, prices);
  }

  const personalType = `personal_${lesson.type}`;
  const byPrice = prices.find(
    (p) =>
      getPriceCategory(p) === "private" &&
      p.lessons === 1 &&
      p.type.trim() === personalType &&
      p.price === lesson.price
  );
  if (byPrice) return getPriceLabel(byPrice);

  const byType = prices.find((p) => p.type.trim() === personalType);
  if (byType) return getPriceLabel(byType);

  const catalog = PRICE_LABELS_CATALOG[personalType];
  if (catalog) return catalog.label;

  if (lesson.type === "pair") return "Индивидуальный Парный Урок";
  if (lesson.type === "trio") return "Индивидуальный Трио Урок";
  return "Индивидуальный Соло Урок";
}

export function formatPairName(
  lastName1: string,
  firstName1: string,
  lastName2: string,
  firstName2: string
): string {
  return `${formatClientName(lastName1, firstName1)} & ${formatClientName(lastName2, firstName2)}`;
}

export function dowShort(dayOfWeek: number): string {
  return DOW_LABELS[dayOfWeek] ?? String(dayOfWeek);
}

export function dowFull(dayOfWeek: number): string {
  return DOW_FULL[dayOfWeek] ?? String(dayOfWeek);
}

export function dowFullEntries(): [number, string][] {
  return ISO_DOW_RANGE.map((d) => [d, dowFull(d)]);
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

export function isDateInYearMonth(dateStr: string, yearMonth: string): boolean {
  const d = new Date(`${dateStr.slice(0, 10)}T12:00:00`);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return key === yearMonth;
}

export interface SubscriptionTariffRef {
  type: string;
  lessonsTotal: number;
  pairMonth: string;
  priceId?: string | null;
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
}

export const PRICE_LABELS_CATALOG: Record<string, { label: string; sub: string; col: string }> = {
  solo: { label: "Соло Абонемент (4 урока)", sub: "Групповые занятия, полмесяца", col: "group" },
  solo_8: { label: "Соло Абонемент (8 уроков)", sub: "Групповые занятия, один месяц", col: "group" },
  pair_hm: { label: "Парный Абонемент (4 урока)", sub: "Групповые занятия, полмесяца", col: "group" },
  pair_m1: { label: "Парный — Месяц 1 (8 уроков)", sub: "Групповые занятия, первый цикл", col: "group" },
  pair_m2: { label: "Парный — Месяц 2 (8 уроков)", sub: "Групповые занятия, второй цикл", col: "group" },
  pair_m3: { label: "Парный — Месяц 3 (8 уроков)", sub: "Групповые занятия, третий цикл", col: "group" },
  personal_solo: { label: "Индивидуальный Соло Урок", sub: "Приватная сессия (1 клиент)", col: "private" },
  personal_pair: { label: "Индивидуальный Парный Урок", sub: "Приватная сессия (2 клиента)", col: "private" },
  personal_trio: { label: "Индивидуальный Трио Урок", sub: "Приватная сессия (3 клиента)", col: "private" },
};

export function getPriceCatalogKey(price: Pick<PriceTariffRef, "type"> & Partial<Pick<PriceTariffRef, "lessons">>): string {
  let lookupKey = price.type.trim();
  if (lookupKey === "solo" && price.lessons === 8) lookupKey = "solo_8";
  return lookupKey;
}

export function getPriceCategory(
  price: Pick<PriceTariffRef, "type"> & Partial<Pick<PriceTariffRef, "category" | "lessons">>
): PriceCategory {
  if (price.category === "group" || price.category === "private") return price.category;
  const catalogCol = PRICE_LABELS_CATALOG[getPriceCatalogKey(price)]?.col;
  if (catalogCol === "private") return "private";
  return "group";
}

export function generateTariffTypeKey(): string {
  const id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  return `tariff_${id}`;
}

export function getPriceLabel(price: PriceTariffRef): string {
  return price.label?.trim() || PRICE_LABELS_CATALOG[getPriceCatalogKey(price)]?.label || price.type;
}

export function getPriceDescription(price: PriceTariffRef): string {
  return (
    price.description?.trim() ||
    PRICE_LABELS_CATALOG[getPriceCatalogKey(price)]?.sub ||
    `${price.lessons} занятий`
  );
}

export function getGroupTariffs<T extends PriceTariffRef>(prices: T[]): T[] {
  return prices.filter((p) => getPriceCategory(p) === "group");
}

export function isGlobalTariff(price: Pick<PriceTariffRef, "locationId">): boolean {
  return !price.locationId;
}

export function filterGroupTariffsForSale<T extends PriceTariffRef & { locationId?: string | null }>(
  prices: T[],
  options: { localPriceList: boolean; locationId?: string | null }
): T[] {
  const groupTariffs = getGroupTariffs(prices);
  if (!options.localPriceList) {
    return groupTariffs.filter(isGlobalTariff);
  }
  if (!options.locationId) return [];
  return groupTariffs.filter((p) => isGlobalTariff(p) || p.locationId === options.locationId);
}

export function getPrivatePackageTariffs<T extends PriceTariffRef>(prices: T[]): T[] {
  return prices.filter((p) => getPriceCategory(p) === "private" && p.lessons > 1);
}

export function getPrivateLessonTariffs<T extends PriceTariffRef>(prices: T[]): T[] {
  return prices.filter((p) => getPriceCategory(p) === "private" && p.lessons === 1);
}

export function tariffNeedsSecondClient(tariff: Pick<PriceTariffRef, "type">): boolean {
  const t = tariff.type.trim();
  return t === "pair_hm" || t.startsWith("pair_m") || t === "personal_pair" || t === "personal_trio";
}

export function tariffNeedsThirdClient(tariff: Pick<PriceTariffRef, "type">): boolean {
  return tariff.type.trim() === "personal_trio";
}

export function tariffParticipantType(tariff: Pick<PriceTariffRef, "type">): "solo" | "pair" | "trio" {
  const t = tariff.type.trim();
  if (t === "personal_pair") return "pair";
  if (t === "personal_trio") return "trio";
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

export function deriveSubscriptionTypeFromTariff(
  tariff: Pick<PriceTariffRef, "type" | "category">
): { type: string; pairMonth: string } {
  const t = tariff.type.trim();
  if (t === "solo") return { type: "solo", pairMonth: "" };
  if (t === "pair_hm") return { type: "pair_hm", pairMonth: "" };
  const pairMonthMatch = t.match(/^pair_m([123])$/);
  if (pairMonthMatch) return { type: "pair", pairMonth: `m${pairMonthMatch[1]}` };
  if (t.startsWith("personal_")) return { type: t.replace("personal_", ""), pairMonth: "" };
  if (CUSTOM_TARIFF_TYPE_RE.test(t)) {
    const category = getPriceCategory(tariff);
    if (category === "private") return { type: "solo", pairMonth: "" };
    return { type: "solo", pairMonth: "" };
  }
  if (getPriceCategory(tariff) === "group") return { type: "solo", pairMonth: "" };
  if (getPriceCategory(tariff) === "private") return { type: "solo", pairMonth: "" };
  return { type: "solo", pairMonth: "" };
}

export interface SubscriptionClientRef {
  type: string;
  clientId1: string;
  clientId2?: string;
  clientId3?: string;
}

export function getSubscriptionClientIds(sub: SubscriptionClientRef): string[] {
  const ids = [sub.clientId1];
  if (sub.clientId2) ids.push(sub.clientId2);
  if (sub.clientId3) ids.push(sub.clientId3);
  return ids;
}

export function bookingClientsMatchSubscription(
  sub: SubscriptionClientRef,
  booking: { clientId1: string; clientId2?: string; clientId3?: string }
): boolean {
  const expected = getSubscriptionClientIds(sub);
  const actual = [booking.clientId1, booking.clientId2, booking.clientId3].filter(Boolean) as string[];
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
  prices: PriceTariffRef[]
): string {
  const matched = findSubscriptionPrice(sub, prices);
  if (matched) return getPriceLabel(matched);

  if (sub.type === "solo") return "Соло";
  if (sub.type === "pair_hm") return `Пара (${sub.lessonsTotal} занятий)`;
  if (sub.type === "pair") return `Пара (${sub.lessonsTotal} занятий)`;
  if (sub.type === "trio") return "Трио";
  return sub.type;
}

export function getSubscriptionPrice(sub: SubscriptionTariffRef, prices: PriceTariffRef[]): number {
  return findSubscriptionPrice(sub, prices)?.price ?? 0;
}
