import type { Client, Payment, PersonalLesson, Subscription } from "../types";
import { formatClientName } from "./utils";

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

function clientContact(clients: Client[], clientId: string): string {
  const client = clients.find((c) => c.id === clientId);
  return client?.telegram?.trim() || "—";
}

function subscriptionClientLabel(sub: Subscription, clients: Client[]): string {
  const names = [sub.clientId1, sub.clientId2, sub.clientId3]
    .filter(Boolean)
    .map((id) => {
      const c = clients.find((client) => client.id === id);
      return c ? formatClientName(c.lastName, c.firstName) : id;
    });
  return names.join(" & ") || sub.clientId1;
}

export function buildDebtorsList(
  subscriptions: Subscription[],
  personalLessons: PersonalLesson[],
  clients: Client[],
  lowBalanceThreshold: number
): DebtorEntry[] {
  const entries: DebtorEntry[] = [];

  for (const sub of subscriptions) {
    if (sub.status !== "active" || sub.lessonsLeft > lowBalanceThreshold) continue;
    entries.push({
      id: `sub-${sub.id}`,
      clientDisplay: subscriptionClientLabel(sub, clients),
      contact: clientContact(clients, sub.clientId1),
      kind: "subscription",
      detail: `Осталось ${sub.lessonsLeft} из ${sub.lessonsTotal} занятий`,
      amount: 0,
    });
  }

  for (const lesson of personalLessons) {
    if (lesson.paid !== "no") continue;
    entries.push({
      id: `pl-${lesson.id}`,
      clientDisplay: lesson.clientDisplay,
      contact: clientContact(clients, lesson.clientId),
      kind: "personal",
      detail: `Персональный · ${lesson.date}`,
      amount: lesson.price,
    });
  }

  return entries.sort((a, b) => b.amount - a.amount || a.clientDisplay.localeCompare(b.clientDisplay));
}

export function sumDebtorAmounts(entries: DebtorEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}
