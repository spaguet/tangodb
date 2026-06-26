import type { Payment } from "../types";

export function monthDateRange(yearMonth: string): { dateFrom: string; dateTo: string } {
  const [y, m] = yearMonth.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, "0");
  return {
    dateFrom: `${y}-${mm}-01`,
    dateTo: `${y}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export interface PaymentStats {
  total: number;
  count: number;
  subscriptionTotal: number;
  personalTotal: number;
  otherTotal: number;
  byMethod: Record<string, number>;
}

export function aggregatePaymentStats(payments: Payment[]): PaymentStats {
  const byMethod: Record<string, number> = {};
  let subscriptionTotal = 0;
  let personalTotal = 0;
  let otherTotal = 0;

  for (const payment of payments) {
    byMethod[payment.method] = (byMethod[payment.method] ?? 0) + payment.amount;
    if (payment.subscriptionId) subscriptionTotal += payment.amount;
    else if (payment.personalLessonId) personalTotal += payment.amount;
    else otherTotal += payment.amount;
  }

  return {
    total: payments.reduce((sum, p) => sum + p.amount, 0),
    count: payments.length,
    subscriptionTotal,
    personalTotal,
    otherTotal,
    byMethod,
  };
}

export interface DebtorEntry {
  id: string;
  clientDisplay: string;
  contact: string;
  kind: "subscription" | "personal";
  detail: string;
  amount: number;
}

export function sumDebtorAmounts(entries: DebtorEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

export const FINANCIAL_TREND_MONTH_COUNT = 6;

export function monthTrendRange(
  endMonth: string,
  monthCount = FINANCIAL_TREND_MONTH_COUNT
): { dateFrom: string; dateTo: string } {
  const startMonth = shiftMonth(endMonth, -(monthCount - 1));
  return {
    dateFrom: monthDateRange(startMonth).dateFrom,
    dateTo: monthDateRange(endMonth).dateTo,
  };
}

export function buildMonthSeries(endMonth: string, monthCount = FINANCIAL_TREND_MONTH_COUNT): string[] {
  const months: string[] = [];
  for (let i = monthCount - 1; i >= 0; i -= 1) {
    months.push(shiftMonth(endMonth, -i));
  }
  return months;
}

export function paymentsInMonth(payments: Payment[], yearMonth: string): Payment[] {
  const { dateFrom, dateTo } = monthDateRange(yearMonth);
  const from = `${dateFrom}T00:00:00`;
  const to = `${dateTo}T23:59:59`;
  return payments.filter((payment) => payment.createdAt >= from && payment.createdAt <= to);
}

export interface MonthlyRevenuePoint {
  month: string;
  total: number;
  subscriptionTotal: number;
  personalTotal: number;
}

export function aggregatePaymentsByMonth(
  payments: Payment[],
  months: string[]
): MonthlyRevenuePoint[] {
  return months.map((month) => {
    const stats = aggregatePaymentStats(paymentsInMonth(payments, month));
    return {
      month,
      total: stats.total,
      subscriptionTotal: stats.subscriptionTotal,
      personalTotal: stats.personalTotal,
    };
  });
}

/** MoM % change; null when previous month had zero revenue (avoid misleading ∞%). */
export function computeMomChangePercent(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function formatMomPercent(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export type RevenueSplitKey = "subscription" | "personal" | "other";

export interface RevenueSplitSegment {
  key: RevenueSplitKey;
  amount: number;
  percent: number;
}

export function buildRevenueSplit(stats: PaymentStats): RevenueSplitSegment[] {
  if (stats.total <= 0) return [];

  const segments: Array<{ key: RevenueSplitKey; amount: number }> = [
    { key: "subscription", amount: stats.subscriptionTotal },
    { key: "personal", amount: stats.personalTotal },
  ];
  if (stats.otherTotal > 0) {
    segments.push({ key: "other", amount: stats.otherTotal });
  }

  return segments
    .filter((segment) => segment.amount > 0)
    .map((segment) => ({
      ...segment,
      percent: (segment.amount / stats.total) * 100,
    }));
}
