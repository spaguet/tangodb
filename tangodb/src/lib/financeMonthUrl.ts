export const FINANCE_MONTH_PARAM = "month";

export function financePathWithMonth(path: string, yearMonth: string): string {
  return `${path}?${FINANCE_MONTH_PARAM}=${encodeURIComponent(yearMonth)}`;
}

export function readFinanceMonthFromSearch(params: URLSearchParams): string | null {
  const raw = params.get(FINANCE_MONTH_PARAM);
  if (!raw || !/^\d{4}-\d{2}$/.test(raw)) return null;
  return raw;
}

export function isFutureYearMonth(yearMonth: string): boolean {
  const [y, m] = yearMonth.split("-").map(Number);
  const now = new Date();
  const currentY = now.getFullYear();
  const currentM = now.getMonth() + 1;
  return y > currentY || (y === currentY && m > currentM);
}
