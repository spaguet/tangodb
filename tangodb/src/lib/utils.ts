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

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  })
    .format(amount)
    .replace("VND", "₫");
}

export function formatClientName(lastName: string, firstName: string): string {
  return `${lastName} ${firstName}`.trim();
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
  priceId?: number | null;
}

export interface PriceTariffRef {
  id?: number;
  type: string;
  lessons: number;
  price: number;
  label?: string;
  description?: string;
  category?: PriceCategory;
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

export function getPriceCatalogKey(price: Pick<PriceTariffRef, "type" | "lessons">): string {
  let lookupKey = price.type.trim();
  if (lookupKey === "solo" && price.lessons === 8) lookupKey = "solo_8";
  return lookupKey;
}

export function getPriceCategory(price: PriceTariffRef): PriceCategory {
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

export function getGroupTariffs(prices: PriceTariffRef[]): PriceTariffRef[] {
  return prices.filter((p) => getPriceCategory(p) === "group");
}

export function getPrivatePackageTariffs(prices: PriceTariffRef[]): PriceTariffRef[] {
  return prices.filter((p) => getPriceCategory(p) === "private" && p.lessons > 1);
}

export function getPrivateLessonTariffs(prices: PriceTariffRef[]): PriceTariffRef[] {
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

export function deriveSubscriptionTypeFromTariff(
  tariff: Pick<PriceTariffRef, "type">
): { type: string; pairMonth: string } {
  const t = tariff.type.trim();
  if (t === "solo") return { type: "solo", pairMonth: "" };
  if (t === "pair_hm") return { type: "pair_hm", pairMonth: "" };
  const pairMonthMatch = t.match(/^pair_m(\d)$/);
  if (pairMonthMatch) return { type: "pair", pairMonth: pairMonthMatch[1] };
  if (t.startsWith("personal_")) return { type: t.replace("personal_", ""), pairMonth: "" };
  return { type: t, pairMonth: "" };
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
  const month = sub.pairMonth || "1";
  return prices.find((p) => p.type.trim() === `pair_m${month}`);
}

export function getSubscriptionTariffLabel(
  sub: SubscriptionTariffRef,
  prices: PriceTariffRef[]
): string {
  const matched = findSubscriptionPrice(sub, prices);
  if (matched) return getPriceLabel(matched);

  if (sub.type === "solo") return "Соло";
  if (sub.type === "pair_hm") return "Пара · полмесяца";
  if (sub.type === "pair") return `Пара · ${sub.pairMonth || "1"}-й месяц`;
  if (sub.type === "trio") return "Трио";
  return sub.type;
}

export function getSubscriptionPrice(sub: SubscriptionTariffRef, prices: PriceTariffRef[]): number {
  return findSubscriptionPrice(sub, prices)?.price ?? 0;
}
