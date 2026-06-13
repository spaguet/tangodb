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

export function getSubscriptionPrice(
  sub: { type: string; lessonsTotal: number; pairMonth: string },
  prices: { type: string; lessons: number; price: number }[]
): number {
  let matched: { price: number } | undefined;
  if (sub.type === "solo") {
    matched = prices.find((p) => p.type.trim() === "solo" && p.lessons === sub.lessonsTotal);
  } else if (sub.lessonsTotal === 4) {
    matched = prices.find((p) => p.type.trim() === "pair_hm");
  } else {
    const month = sub.pairMonth || "1";
    matched = prices.find((p) => p.type.trim() === `pair_m${month}`);
  }
  return matched?.price ?? 0;
}
