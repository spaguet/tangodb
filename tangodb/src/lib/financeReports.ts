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
