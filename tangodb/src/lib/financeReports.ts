import type {
  AttendanceRecord,
  Client,
  Payment,
  PersonalLesson,
  ScheduleSlot,
  SubscriptionGroupLink,
} from "../types";

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
  lessonsLeft?: number | null;
  lessonsTotal?: number | null;
  lessonDate?: string | null;
}

export function formatDebtorDetail(
  entry: DebtorEntry,
  translate: (key: import("./i18n/keys").I18nKey, params?: Record<string, string | number>) => string,
  formatDate?: (iso: string | Date, options?: Intl.DateTimeFormatOptions) => string
): string {
  if (entry.kind === "subscription" && entry.lessonsLeft != null && entry.lessonsTotal != null) {
    return translate("finance.debtors.detail.subscription", {
      left: entry.lessonsLeft,
      total: entry.lessonsTotal,
    });
  }
  if (entry.kind === "personal" && entry.lessonDate) {
    const dateLabel = formatDate ? formatDate(entry.lessonDate) : entry.lessonDate;
    return translate("finance.debtors.detail.personal", { date: dateLabel });
  }
  return entry.detail;
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

export function recordsInMonth(
  createdAt: string | undefined,
  yearMonth: string
): boolean {
  if (!createdAt) return false;
  const { dateFrom, dateTo } = monthDateRange(yearMonth);
  const from = `${dateFrom}T00:00:00`;
  const to = `${dateTo}T23:59:59`;
  return createdAt >= from && createdAt <= to;
}

export function countNewClientsInMonth(clients: Client[], yearMonth: string): number {
  return clients.filter((client) => recordsInMonth(client.createdAt, yearMonth)).length;
}

export interface RevenueRankEntry {
  key: string;
  label: string;
  amount: number;
}

export function buildTopClientsByRevenue(
  payments: Payment[],
  limit = 5
): RevenueRankEntry[] {
  const totals = new Map<string, { label: string; amount: number }>();

  for (const payment of payments) {
    const key = payment.clientId || payment.clientDisplay;
    if (!key) continue;
    const existing = totals.get(key);
    if (existing) {
      existing.amount += payment.amount;
    } else {
      totals.set(key, { label: payment.clientDisplay || key, amount: payment.amount });
    }
  }

  return [...totals.entries()]
    .map(([key, { label, amount }]) => ({ key, label, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export function buildClassTeacherMap(slots: ScheduleSlot[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const slot of slots) {
    const groupId = slot.scheduleGroupId;
    if (groupId && slot.teacherMemberId && !map.has(groupId)) {
      map.set(groupId, slot.teacherMemberId);
    }
  }
  return map;
}

export interface TeacherRevenueContext {
  personalLessonById: Map<string, Pick<PersonalLesson, "teacherMemberId">>;
  groupsBySubId: Record<string, SubscriptionGroupLink[]>;
  classTeacherByGroupId: Map<string, string>;
  teacherLabels: Map<string, string>;
}

export function resolvePaymentTeacherId(
  payment: Payment,
  ctx: TeacherRevenueContext
): string | null {
  if (payment.personalLessonId) {
    return ctx.personalLessonById.get(payment.personalLessonId)?.teacherMemberId ?? null;
  }
  if (payment.subscriptionId) {
    for (const group of ctx.groupsBySubId[payment.subscriptionId] ?? []) {
      const teacherId = ctx.classTeacherByGroupId.get(group.scheduleGroupId);
      if (teacherId) return teacherId;
    }
  }
  return null;
}

export function buildTopTeachersByRevenue(
  payments: Payment[],
  ctx: TeacherRevenueContext,
  limit = 5
): RevenueRankEntry[] {
  const totals = new Map<string, number>();

  for (const payment of payments) {
    const teacherId = resolvePaymentTeacherId(payment, ctx);
    if (!teacherId) continue;
    totals.set(teacherId, (totals.get(teacherId) ?? 0) + payment.amount);
  }

  return [...totals.entries()]
    .map(([key, amount]) => ({
      key,
      label: ctx.teacherLabels.get(key) ?? key,
      amount,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

export interface OccupancyStats {
  present: number;
  absent: number;
  marked: number;
  rate: number | null;
}

export function computeOccupancyStats(
  attendance: AttendanceRecord[],
  personalLessons: PersonalLesson[]
): OccupancyStats {
  let present = 0;
  let absent = 0;

  for (const record of attendance) {
    if (record.attendanceStatus === "present") present += 1;
    else if (record.attendanceStatus === "absent") absent += 1;
  }

  for (const lesson of personalLessons) {
    if (lesson.attendanceStatus === "present") present += 1;
    else if (lesson.attendanceStatus === "absent") absent += 1;
  }

  const marked = present + absent;
  return {
    present,
    absent,
    marked,
    rate: marked > 0 ? (present / marked) * 100 : null,
  };
}

export function formatOccupancyPercent(rate: number | null): string {
  if (rate === null) return "—";
  return `${rate.toFixed(0)}%`;
}
