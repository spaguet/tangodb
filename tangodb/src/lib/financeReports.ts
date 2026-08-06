import type {
  AttendanceRecord,
  Client,
  Payment,
  PaymentMethod,
  PersonalLesson,
  RentalMoneyRegisterEntry,
  ScheduleSlot,
  SingleVisit,
  SubscriptionGroupLink,
} from "../types";
import type { SubscriptionRefundRecord } from "../lib/subscriptionRefund";
import { groupSubscriptionParticipantCount } from "../lib/subscriptionMembers";
import {
  aggregateEffectivePaymentTotal,
  paymentEffectiveAmount,
  type PaymentWithCorrectionMeta,
} from "../lib/paymentCorrection";

function rankPaymentAmount(payment: Payment | PaymentWithCorrectionMeta): number {
  if ("operationKind" in payment && payment.operationKind) {
    return paymentEffectiveAmount(payment as PaymentWithCorrectionMeta);
  }
  return payment.amount;
}

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
  singleVisitTotal: number;
  otherTotal: number;
  byMethod: Record<string, number>;
}

export interface RevenueStats extends PaymentStats {
  grossTotal: number;
  refundsTotal: number;
  pendingRefundsTotal: number;
  netTotal: number;
  refundCount: number;
  pendingRefundCount: number;
}

export function aggregateRefundStats(refunds: SubscriptionRefundRecord[]): {
  completedTotal: number;
  completedCount: number;
  pendingTotal: number;
  pendingCount: number;
} {
  let completedTotal = 0;
  let completedCount = 0;
  let pendingTotal = 0;
  let pendingCount = 0;

  for (const refund of refunds) {
    if (refund.status === "completed") {
      completedTotal += refund.amount;
      completedCount += 1;
    } else if (refund.status === "pending") {
      pendingTotal += refund.amount;
      pendingCount += 1;
    }
  }

  return { completedTotal, completedCount, pendingTotal, pendingCount };
}

export function refundsInMonth(
  refunds: SubscriptionRefundRecord[],
  yearMonth: string
): SubscriptionRefundRecord[] {
  const { dateFrom, dateTo } = monthDateRange(yearMonth);
  return refunds.filter(
    (refund) =>
      refund.status === "completed" &&
      refund.operationDate >= dateFrom &&
      refund.operationDate <= dateTo
  );
}

export interface RentalPaymentAggregate {
  total: number;
  grossInflow: number;
  count: number;
  byMethod: Record<string, number>;
}

/** Unified rental money register aggregates (stage 5). */
export function aggregateRentalMoneyRegisterStats(
  entries: Array<Pick<RentalMoneyRegisterEntry, "signedAmount" | "method">>
): RentalPaymentAggregate {
  const byMethod: Record<string, number> = {};
  let total = 0;
  let grossInflow = 0;
  let count = 0;

  for (const entry of entries) {
    const amount = entry.signedAmount;
    if (amount === 0) continue;
    total += amount;
    if (amount > 0) {
      grossInflow += amount;
      count += 1;
    }
    byMethod[entry.method] = (byMethod[entry.method] ?? 0) + amount;
  }

  return { total, grossInflow, count, byMethod };
}

/** @deprecated Use aggregateRentalMoneyRegisterStats */
export function aggregateRentalPaymentStats(
  payments: Array<{ amount: number; method: string }>
): RentalPaymentAggregate {
  return aggregateRentalMoneyRegisterStats(
    payments.map((p) => ({ signedAmount: p.amount, method: p.method as PaymentMethod }))
  );
}

export function mergePaymentStatsWithRentals<T extends PaymentStats>(
  base: T,
  rentalStats: RentalPaymentAggregate
): T {
  const byMethod = { ...base.byMethod };
  for (const [method, amount] of Object.entries(rentalStats.byMethod)) {
    byMethod[method] = (byMethod[method] ?? 0) + amount;
  }
  return {
    ...base,
    count: base.count + rentalStats.count,
    byMethod,
  };
}

export interface ExtendedRevenueStats extends RevenueStats {
  /** Gross rental inflow (positive payments only). */
  rentalTotal: number;
  /** Signed rental register total (includes returns/adjustments). */
  rentalNetTotal: number;
}

export function buildExtendedRevenueStats(
  payments: Payment[],
  refunds: SubscriptionRefundRecord[],
  options?: {
    otherIncomeAmount?: number;
    rentalRegisterEntries?: Array<Pick<RentalMoneyRegisterEntry, "signedAmount" | "method">>;
    /** @deprecated Use rentalRegisterEntries */
    rentalPayments?: Array<{ amount: number; method: string }>;
  }
): ExtendedRevenueStats {
  const base = combineRevenueStats(payments, refunds);
  const otherFromTable = options?.otherIncomeAmount ?? 0;
  const rentalStats = aggregateRentalMoneyRegisterStats(
    options?.rentalRegisterEntries ??
      (options?.rentalPayments ?? []).map((p) => ({
        signedAmount: p.amount,
        method: p.method as PaymentMethod,
      }))
  );
  const withRentals = mergePaymentStatsWithRentals(base, rentalStats);

  return {
    ...withRentals,
    otherTotal: base.otherTotal + otherFromTable,
    rentalTotal: rentalStats.grossInflow,
    rentalNetTotal: rentalStats.total,
    grossTotal: base.grossTotal + otherFromTable + rentalStats.grossInflow,
    netTotal: base.netTotal + otherFromTable + rentalStats.total,
    total: base.netTotal + otherFromTable + rentalStats.total,
  };
}

export function combineRevenueStats(
  payments: Payment[],
  refunds: SubscriptionRefundRecord[]
): RevenueStats {
  const paymentStats = aggregatePaymentStats(payments);
  const refundStats = aggregateRefundStats(refunds);
  const grossTotal = paymentStats.total;
  const netTotal = grossTotal - refundStats.completedTotal;

  return {
    ...paymentStats,
    subscriptionTotal: paymentStats.subscriptionTotal - refundStats.completedTotal,
    grossTotal,
    refundsTotal: refundStats.completedTotal,
    pendingRefundsTotal: refundStats.pendingTotal,
    netTotal,
    refundCount: refundStats.completedCount,
    pendingRefundCount: refundStats.pendingCount,
  };
}

export function aggregatePaymentStats(payments: Payment[]): PaymentStats;
export function aggregatePaymentStats(payments: PaymentWithCorrectionMeta[]): PaymentStats;
export function aggregatePaymentStats(
  payments: Array<Payment | PaymentWithCorrectionMeta>
): PaymentStats {
  const byMethod: Record<string, number> = {};
  let subscriptionTotal = 0;
  let personalTotal = 0;
  let singleVisitTotal = 0;
  let otherTotal = 0;

  for (const payment of payments) {
    const effective =
      "operationKind" in payment && payment.operationKind
        ? payment.operationKind === "storno"
          ? -payment.amount
          : payment.amount
        : payment.amount;
    if (effective === 0) continue;

    byMethod[payment.method] = (byMethod[payment.method] ?? 0) + effective;
    if (payment.subscriptionId) subscriptionTotal += effective;
    else if (payment.personalLessonId) personalTotal += effective;
    else if (payment.singleVisitId) singleVisitTotal += effective;
    else otherTotal += effective;
  }

  const withMeta = payments as PaymentWithCorrectionMeta[];
  const total =
    withMeta.some((p) => p.operationKind != null)
      ? aggregateEffectivePaymentTotal(withMeta)
      : payments.reduce((sum, p) => sum + p.amount, 0);

  return {
    total,
    count: payments.filter((p) => {
      const meta = p as PaymentWithCorrectionMeta;
      return meta.operationKind !== "storno";
    }).length,
    subscriptionTotal,
    personalTotal,
    singleVisitTotal,
    otherTotal,
    byMethod,
  };
}

export interface DebtorEntry {
  id: string;
  personalLessonId?: string | null;
  clientId1?: string | null;
  clientId2?: string | null;
  clientId3?: string | null;
  lessonTimeStart?: string | null;
  lessonTimeEnd?: string | null;
  locationId?: string | null;
  disciplineId?: string | null;
  rentalId?: string | null;
  renterId?: string | null;
  clientDisplay: string;
  contact: string;
  kind: "subscription" | "personal" | "rental";
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
  if (entry.kind === "rental" && entry.lessonDate) {
    const dateLabel = formatDate ? formatDate(entry.lessonDate) : entry.lessonDate;
    return translate("finance.debtors.detail.rental", { date: dateLabel });
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

export function buildDaySeries(yearMonth: string): string[] {
  const { dateFrom, dateTo } = monthDateRange(yearMonth);
  const days: string[] = [];
  const cursor = new Date(`${dateFrom}T12:00:00`);
  const end = new Date(`${dateTo}T12:00:00`);
  while (cursor <= end) {
    const y = cursor.getFullYear();
    const m = String(cursor.getMonth() + 1).padStart(2, "0");
    const d = String(cursor.getDate()).padStart(2, "0");
    days.push(`${y}-${m}-${d}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export function paymentsOnDay(payments: Payment[], day: string): Payment[] {
  const from = `${day}T00:00:00`;
  const to = `${day}T23:59:59`;
  return payments.filter((payment) => payment.createdAt >= from && payment.createdAt <= to);
}

export function aggregatePaymentsByDay(
  payments: Payment[],
  days: string[]
): MonthlyRevenuePoint[] {
  return days.map((day) => {
    const stats = aggregatePaymentStats(paymentsOnDay(payments, day));
    return {
      month: day,
      total: stats.total,
      subscriptionTotal: stats.subscriptionTotal,
      personalTotal: stats.personalTotal,
      singleVisitTotal: stats.singleVisitTotal,
    };
  });
}

export type RevenueTrendPeriod = "month" | "6months" | "year";

export function revenueTrendMonthCount(period: RevenueTrendPeriod): number {
  if (period === "year") return 12;
  if (period === "6months") return FINANCIAL_TREND_MONTH_COUNT;
  return 1;
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
  singleVisitTotal: number;
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
      singleVisitTotal: stats.singleVisitTotal,
    };
  });
}

export interface ExtendedRevenueTrendContext {
  payments: Payment[];
  refunds: SubscriptionRefundRecord[];
  otherIncome: Array<{ amount: number; createdAt: string }>;
  rentalEntries: Array<Pick<RentalMoneyRegisterEntry, "signedAmount" | "method" | "operationDate">>;
}

export function otherIncomeOnDay(
  items: ExtendedRevenueTrendContext["otherIncome"],
  day: string
): number {
  const from = `${day}T00:00:00`;
  const to = `${day}T23:59:59`;
  return items
    .filter((item) => item.createdAt >= from && item.createdAt <= to)
    .reduce((sum, item) => sum + item.amount, 0);
}

export function otherIncomeInMonth(
  items: ExtendedRevenueTrendContext["otherIncome"],
  yearMonth: string
): number {
  const { dateFrom, dateTo } = monthDateRange(yearMonth);
  const from = `${dateFrom}T00:00:00`;
  const to = `${dateTo}T23:59:59`;
  return items
    .filter((item) => item.createdAt >= from && item.createdAt <= to)
    .reduce((sum, item) => sum + item.amount, 0);
}

export function rentalEntriesOnDay(
  entries: ExtendedRevenueTrendContext["rentalEntries"],
  day: string
): ExtendedRevenueTrendContext["rentalEntries"] {
  return entries.filter((entry) => entry.operationDate === day);
}

export function rentalEntriesInMonth(
  entries: ExtendedRevenueTrendContext["rentalEntries"],
  yearMonth: string
): ExtendedRevenueTrendContext["rentalEntries"] {
  const { dateFrom, dateTo } = monthDateRange(yearMonth);
  return entries.filter(
    (entry) => entry.operationDate >= dateFrom && entry.operationDate <= dateTo
  );
}

export function buildExtendedTrendPoints(
  series: string[],
  ctx: ExtendedRevenueTrendContext,
  mode: "day" | "month"
): MonthlyRevenuePoint[] {
  return series.map((key) => {
    const payments =
      mode === "day" ? paymentsOnDay(ctx.payments, key) : paymentsInMonth(ctx.payments, key);
    const monthRefunds =
      mode === "day"
        ? ctx.refunds.filter(
            (refund) => refund.status === "completed" && refund.operationDate === key
          )
        : refundsInMonth(ctx.refunds, key);
    const otherAmount =
      mode === "day"
        ? otherIncomeOnDay(ctx.otherIncome, key)
        : otherIncomeInMonth(ctx.otherIncome, key);
    const rentalSlice =
      mode === "day"
        ? rentalEntriesOnDay(ctx.rentalEntries, key)
        : rentalEntriesInMonth(ctx.rentalEntries, key);
    const stats = buildExtendedRevenueStats(payments, monthRefunds, {
      otherIncomeAmount: otherAmount,
      rentalRegisterEntries: rentalSlice,
    });
    return {
      month: key,
      total: stats.netTotal,
      subscriptionTotal: stats.subscriptionTotal,
      personalTotal: stats.personalTotal,
      singleVisitTotal: stats.singleVisitTotal,
    };
  });
}

export function extendedNetTotalForMonth(
  yearMonth: string,
  ctx: ExtendedRevenueTrendContext
): number {
  const payments = paymentsInMonth(ctx.payments, yearMonth);
  const monthRefunds = refundsInMonth(ctx.refunds, yearMonth);
  const otherAmount = otherIncomeInMonth(ctx.otherIncome, yearMonth);
  const rentalSlice = rentalEntriesInMonth(ctx.rentalEntries, yearMonth);
  return buildExtendedRevenueStats(payments, monthRefunds, {
    otherIncomeAmount: otherAmount,
    rentalRegisterEntries: rentalSlice,
  }).netTotal;
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

export type RevenueSplitKey = "subscription" | "personal" | "single_visit" | "other" | "rental";

export interface RevenueSplitSegment {
  key: RevenueSplitKey;
  amount: number;
  percent: number;
}

export function buildRevenueSplit(
  stats: PaymentStats & { rentalTotal?: number; rentalNetTotal?: number; netTotal?: number }
): RevenueSplitSegment[] {
  const rentalAmount = stats.rentalNetTotal ?? stats.rentalTotal ?? 0;
  const segments: Array<{ key: RevenueSplitKey; amount: number }> = [
    { key: "subscription", amount: stats.subscriptionTotal },
    { key: "personal", amount: stats.personalTotal },
    { key: "single_visit", amount: stats.singleVisitTotal },
  ];
  if (stats.otherTotal > 0) {
    segments.push({ key: "other", amount: stats.otherTotal });
  }
  if (rentalAmount > 0) {
    segments.push({ key: "rental", amount: rentalAmount });
  }

  const positive = segments.filter((segment) => segment.amount > 0);
  const denom = positive.reduce((sum, segment) => sum + segment.amount, 0);
  if (denom <= 0) return [];

  return positive.map((segment) => ({
    ...segment,
    percent: (segment.amount / denom) * 100,
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
    const amount = rankPaymentAmount(payment);
    if (existing) {
      existing.amount += amount;
    } else {
      totals.set(key, { label: payment.clientDisplay || key, amount });
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

export function buildClassLocationMap(slots: ScheduleSlot[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const slot of slots) {
    const groupId = slot.scheduleGroupId;
    if (groupId && slot.locationId && !map.has(groupId)) {
      map.set(groupId, slot.locationId);
    }
  }
  return map;
}

export interface TeacherRevenueContext {
  personalLessonById: Map<string, Pick<PersonalLesson, "teacherMemberId" | "locationId">>;
  singleVisitById: Map<string, Pick<SingleVisit, "teacherMemberId" | "locationId">>;
  groupsBySubId: Record<string, SubscriptionGroupLink[]>;
  classTeacherByGroupId: Map<string, string>;
  classLocationByGroupId: Map<string, string>;
  teacherLabels: Map<string, string>;
}

export function resolvePaymentTeacherId(
  payment: Payment,
  ctx: TeacherRevenueContext
): string | null {
  if (payment.personalLessonId) {
    return ctx.personalLessonById.get(payment.personalLessonId)?.teacherMemberId ?? null;
  }
  if (payment.singleVisitId) {
    return ctx.singleVisitById.get(payment.singleVisitId)?.teacherMemberId ?? null;
  }
  if (payment.subscriptionId) {
    for (const group of ctx.groupsBySubId[payment.subscriptionId] ?? []) {
      const teacherId = ctx.classTeacherByGroupId.get(group.scheduleGroupId);
      if (teacherId) return teacherId;
    }
  }
  return null;
}

export function resolvePaymentLocationId(
  payment: Payment,
  ctx: Pick<
    TeacherRevenueContext,
    "personalLessonById" | "singleVisitById" | "groupsBySubId" | "classLocationByGroupId"
  >
): string | null {
  if (payment.personalLessonId) {
    return ctx.personalLessonById.get(payment.personalLessonId)?.locationId ?? null;
  }
  if (payment.singleVisitId) {
    return ctx.singleVisitById.get(payment.singleVisitId)?.locationId ?? null;
  }
  if (payment.subscriptionId) {
    for (const group of ctx.groupsBySubId[payment.subscriptionId] ?? []) {
      const locationId = ctx.classLocationByGroupId.get(group.scheduleGroupId);
      if (locationId) return locationId;
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
    totals.set(teacherId, (totals.get(teacherId) ?? 0) + rankPaymentAmount(payment));
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
  personalLessons: PersonalLesson[],
  singleVisits: SingleVisit[] = [],
  subscriptionTypesById: Record<string, string> = {}
): OccupancyStats {
  let present = 0;
  let absent = 0;

  const participantCount = (subscriptionId: string) => {
    const type = subscriptionTypesById[subscriptionId];
    return type ? groupSubscriptionParticipantCount(type) : 1;
  };

  for (const record of attendance) {
    const count = participantCount(record.subscriptionId);
    if (record.attendanceStatus === "present") present += count;
    else if (record.attendanceStatus === "absent") absent += count;
  }

  for (const lesson of personalLessons) {
    if (lesson.attendanceStatus === "present") present += 1;
    else if (lesson.attendanceStatus === "absent") absent += 1;
  }

  present += singleVisits.length;

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
