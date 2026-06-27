import { useEffect, useMemo, useState, Fragment } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import AppSelect from "../components/ui/AppSelect";
import DatePickerField from "../components/ui/DatePickerField";
import { useToast } from "../App";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { memberListLabel, memberRoleLabel, useTeamMembers } from "../hooks/useTeamMembers";
import { usePayments } from "../hooks/usePayments";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import { useSchedule } from "../hooks/useSchedule";
import { useSubscriptionGroups } from "../hooks/useSubscriptionGroups";
import { useSingleVisits } from "../hooks/useSingleVisits";
import {
  activeRateByMember,
  useOwnTeacherSettlements,
  useRecalculateTeacherSettlement,
  useRecordSettlementPayment,
  useSettlementPayments,
  useTeacherPayRates,
  useTeacherSettlements,
} from "../hooks/usePayroll";
import { PAYMENT_METHOD_KEYS } from "../hooks/usePayments";
import {
  buildClassTeacherMap,
  monthDateRange,
  paymentsInMonth,
  type TeacherRevenueContext,
} from "../lib/financeReports";
import { computeTeacherAccrualBreakdown } from "../lib/payrollAccrual";
import { settlementBalance } from "../lib/payrollAccrual";
import { shiftMonth } from "../lib/financeReports";
import { resolveMutationError } from "../lib/resolveMutationError";
import { currentYearMonth, formatCurrency, formatMonthTitle } from "../lib/utils";
import { toISODateLocal } from "../lib/scheduleWeek";
import type { TeacherPayRate, TeacherSettlement } from "../types/payroll";
import type { PaymentMethod, Payment } from "../types";

const inputCls =
  "w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 font-sans";
const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function fixedSalaryDisplay(rate: TeacherPayRate | undefined): string {
  if (!rate) return "—";
  if (rate.payMode === "percent") return "—";
  if (rate.fixedAmount <= 0) return "—";
  return formatCurrency(rate.fixedAmount);
}

function payRatePercentLabel(rate: TeacherPayRate | undefined, t: ReturnType<typeof useI18n>["t"]): string {
  if (!rate) return "—";
  if (rate.payMode === "fixed") return "—";
  return t("finance.payroll.ratePercentSplit", {
    group: rate.groupRatePercent,
    personal: rate.personalRatePercent,
    singleVisit: rate.singleVisitRatePercent,
  });
}

function SettlementPaymentsList({
  settlementId,
  memberNameById,
}: {
  settlementId: string;
  memberNameById: Map<string, string>;
}) {
  const { t, formatDate } = useI18n();
  const paymentsQuery = useSettlementPayments(settlementId);

  if (paymentsQuery.isLoading) {
    return <p className="text-xs text-slate-400 py-2">{t("common.loading.default")}</p>;
  }
  if (paymentsQuery.isError) {
    return <QueryErrorState error={paymentsQuery.error} />;
  }

  const payments = paymentsQuery.data ?? [];
  if (payments.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-1.5 pt-2 border-t border-slate-100">
      {payments.map((payment) => {
        const dateLabel = formatDate(payment.paidAt, { day: "numeric", month: "short", year: "numeric" });
        const issuer = payment.createdBy
          ? memberNameById.get(payment.createdBy) ?? payment.createdBy
          : t("team.auditSystem");
        return (
          <li key={payment.id} className="flex items-center justify-between gap-2 text-xs font-sans">
            <span className="text-slate-600">
              {t("finance.payroll.paymentIssuedBy", { date: dateLabel, issuer })}
              {payment.note ? ` · ${payment.note}` : ""}
            </span>
            <span className="font-semibold text-emerald-700 whitespace-nowrap">
              {formatCurrency(payment.amount)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MemberPayrollBreakdown({
  memberId,
  rate,
  settlement,
  yearMonth,
  payments,
  teacherCtx,
  memberNameById,
}: {
  memberId: string;
  rate: TeacherPayRate | undefined;
  settlement: TeacherSettlement | undefined;
  yearMonth: string;
  payments: Payment[];
  teacherCtx: TeacherRevenueContext;
  memberNameById: Map<string, string>;
}) {
  const { t } = useI18n();
  const monthPayments = useMemo(
    () => paymentsInMonth(payments, yearMonth),
    [payments, yearMonth]
  );
  const breakdown = useMemo(
    () => computeTeacherAccrualBreakdown(monthPayments, memberId, rate, teacherCtx),
    [monthPayments, memberId, rate, teacherCtx]
  );

  const rows = [
    { label: t("finance.payroll.breakdownFixed"), amount: breakdown.fixedAmount },
    { label: t("finance.payroll.breakdownGroup"), amount: breakdown.groupPercentAmount },
    { label: t("finance.payroll.breakdownPersonal"), amount: breakdown.personalPercentAmount },
    { label: t("finance.payroll.breakdownSingleVisit"), amount: breakdown.singleVisitPercentAmount },
  ];

  return (
    <div className="px-3 py-3 bg-slate-50/80 rounded-lg border border-slate-100 space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        {rows.map((row) => (
          <div key={row.label} className="text-xs font-sans">
            <p className="text-[10px] text-slate-400 uppercase font-semibold">{row.label}</p>
            <p className="font-semibold text-slate-800 mt-0.5">{formatCurrency(row.amount)}</p>
          </div>
        ))}
      </div>
      {settlement && settlement.amountPaid > 0 && (
        <SettlementPaymentsList settlementId={settlement.id} memberNameById={memberNameById} />
      )}
    </div>
  );
}

function RecordPaymentModal({
  settlement,
  onClose,
}: {
  settlement: TeacherSettlement;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const recordPayment = useRecordSettlementPayment();
  const balance = settlementBalance(settlement);
  const todayIso = toISODateLocal(new Date());

  const [amount, setAmount] = useState(balance > 0 ? balance : 0);
  const [paidAt, setPaidAt] = useState(todayIso);
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [note, setNote] = useState("");

  const handleSubmit = async () => {
    if (amount <= 0) {
      toast(t("finance.payroll.error.amount"), "error");
      return;
    }
    if (paidAt > todayIso) {
      toast(t("finance.payroll.error.futureDate"), "error");
      return;
    }

    const result = await recordPayment.mutateAsync({
      settlementId: settlement.id,
      amount,
      paidAt,
      method,
      note,
    });

    if (!result.success) {
      toast(resolveMutationError(result.error, "finance.payroll.error.record", t), "error");
      return;
    }

    toast(t("finance.payroll.recordSuccess"), "success");
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
      />
      <motion.div
        initial={{ scale: 0.97, opacity: 0, y: 8 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.97, opacity: 0, y: 8 }}
        className="relative bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full p-4 panel-card-stack"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-semibold text-slate-900">{t("finance.payroll.recordTitle")}</h3>
          <button type="button" onClick={onClose} aria-label={t("common.close")} className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="panel-form-stack font-sans">
          <p className="text-xs text-slate-500">
            {t(balance < 0 ? "finance.payroll.advanceBalance" : "finance.payroll.balanceDue")}:{" "}
            <span className="font-semibold text-slate-800">{formatCurrency(balance)}</span>
          </p>
          <label className="block space-y-1">
            <span className={labelCls}>{t("finance.payroll.amountLabel")}</span>
            <input
              type="number"
              min={0}
              step={0.01}
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              className={inputCls}
            />
          </label>
          <DatePickerField label={t("finance.payroll.paidAtLabel")} value={paidAt} max={todayIso} onChange={setPaidAt} />
          <AppSelect label={t("finance.payroll.methodLabel")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(PAYMENT_METHOD_KEYS) as PaymentMethod[]).map((key) => (
              <option key={key} value={key}>
                {t(PAYMENT_METHOD_KEYS[key])}
              </option>
            ))}
          </AppSelect>
          <label className="block space-y-1">
            <span className={labelCls}>{t("finance.payroll.noteLabel")}</span>
            <input type="text" value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
          </label>
        </div>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={recordPayment.isPending}
            className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans text-xs rounded-lg cursor-pointer disabled:opacity-60"
          >
            {recordPayment.isPending ? t("common.saving") : t("finance.payroll.recordSubmit")}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans text-xs rounded-lg cursor-pointer"
          >
            {t("common.cancel")}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function AdminPayrollTable({ yearMonth }: { yearMonth: string }) {
  const { t, locale } = useI18n();
  const { can } = usePermissions();
  const canWrite = can("payroll.write");

  const teamQuery = useTeamMembers();
  const ratesQuery = useTeacherPayRates();
  const settlementsQuery = useTeacherSettlements(yearMonth);
  const recalculate = useRecalculateTeacherSettlement();
  const monthRange = monthDateRange(yearMonth);
  const paymentsQuery = usePayments({ dateFrom: monthRange.dateFrom, dateTo: monthRange.dateTo });
  const scheduleQuery = useSchedule();
  const personalLessonsQuery = usePersonalLessons();
  const singleVisitsQuery = useSingleVisits({ yearMonth });
  const subscriptionGroupsQuery = useSubscriptionGroups();

  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);
  const [paymentTarget, setPaymentTarget] = useState<TeacherSettlement | null>(null);

  useEffect(() => {
    if (!canWrite) return;
    void recalculate.mutateAsync(yearMonth);
  }, [yearMonth, canWrite]);

  const payrollMembers = useMemo(
    () => (teamQuery.data ?? []).filter((m) => m.is_active),
    [teamQuery.data]
  );

  const rateMap = useMemo(
    () => activeRateByMember(ratesQuery.data ?? []),
    [ratesQuery.data]
  );

  const settlementByMember = useMemo(() => {
    const map = new Map<string, TeacherSettlement>();
    for (const row of settlementsQuery.data ?? []) {
      map.set(row.memberId, row);
    }
    return map;
  }, [settlementsQuery.data]);

  const memberNameById = useMemo(
    () => new Map((teamQuery.data ?? []).map((member) => [member.id, memberListLabel(member, locale)])),
    [teamQuery.data, locale]
  );

  const teacherCtx = useMemo((): TeacherRevenueContext => {
    const personalLessonById = new Map(
      (personalLessonsQuery.data ?? []).map((lesson) => [lesson.id, lesson])
    );
    const singleVisitById = new Map(
      (singleVisitsQuery.data ?? []).map((visit) => [visit.id, visit])
    );
    return {
      personalLessonById,
      singleVisitById,
      groupsBySubId: subscriptionGroupsQuery.groupsBySubId,
      classTeacherByGroupId: buildClassTeacherMap(scheduleQuery.data ?? []),
      teacherLabels: memberNameById,
    };
  }, [
    personalLessonsQuery.data,
    singleVisitsQuery.data,
    subscriptionGroupsQuery.groupsBySubId,
    scheduleQuery.data,
    memberNameById,
  ]);

  const payments = paymentsQuery.data ?? [];

  if (
    teamQuery.isLoading ||
    ratesQuery.isLoading ||
    settlementsQuery.isLoading ||
    paymentsQuery.isLoading ||
    scheduleQuery.isLoading ||
    personalLessonsQuery.isLoading ||
    singleVisitsQuery.isLoading ||
    subscriptionGroupsQuery.isLoading ||
    recalculate.isPending
  ) {
    return <LoadingState label={t("finance.payroll.loading")} />;
  }
  if (teamQuery.isError) return <QueryErrorState error={teamQuery.error} />;
  if (ratesQuery.isError) return <QueryErrorState error={ratesQuery.error} />;
  if (settlementsQuery.isError) return <QueryErrorState error={settlementsQuery.error} />;
  if (paymentsQuery.isError) return <QueryErrorState error={paymentsQuery.error} />;

  if (payrollMembers.length === 0) {
    return (
      <p className="text-sm text-slate-400 py-8 text-center">{t("finance.payroll.noMembers")}</p>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm font-sans">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-100">
              <th className="text-left py-2 px-3 font-semibold">{t("finance.payroll.colMember")}</th>
              <th className="text-right py-2 px-3 font-semibold">{t("finance.payroll.colFixedSalary")}</th>
              <th className="text-right py-2 px-3 font-semibold">{t("finance.payroll.colRate")}</th>
              <th className="text-right py-2 px-3 font-semibold">{t("finance.payroll.colAccrued")}</th>
              <th className="text-right py-2 px-3 font-semibold">{t("finance.payroll.colPaid")}</th>
              <th className="text-right py-2 px-3 font-semibold">{t("finance.payroll.colBalance")}</th>
              {canWrite && <th className="py-2 px-3" />}
            </tr>
          </thead>
          <tbody>
            {payrollMembers.map((member) => {
              const rate = rateMap.get(member.id);
              const settlement = settlementByMember.get(member.id);
              const accrued = settlement?.amountAccrued ?? 0;
              const paid = settlement?.amountPaid ?? 0;
              const balance = settlement ? settlementBalance(settlement) : 0;
              const expanded = expandedMemberId === member.id;

              return (
                <Fragment key={member.id}>
                  <tr className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="py-2.5 px-3">
                      <button
                        type="button"
                        onClick={() => setExpandedMemberId(expanded ? null : member.id)}
                        className="text-left w-full group cursor-pointer"
                      >
                        <div className="flex items-start gap-1.5">
                          <span className="mt-0.5 text-slate-400 group-hover:text-indigo-500 transition-colors">
                            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </span>
                          <span>
                            <p className="font-semibold text-slate-800 group-hover:text-indigo-700 transition-colors">
                              {memberListLabel(member, locale)}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{memberRoleLabel(member.role, member.meta, locale)}</p>
                            {!rate && (
                              <p className="text-[10px] text-amber-600 mt-0.5">{t("finance.payroll.noRate")}</p>
                            )}
                          </span>
                        </div>
                      </button>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 whitespace-nowrap">
                      {fixedSalaryDisplay(rate)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600">
                      {payRatePercentLabel(rate, t)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-slate-800">{formatCurrency(accrued)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-700">{formatCurrency(paid)}</td>
                    <td className="py-2.5 px-3 text-right font-semibold text-indigo-700">{formatCurrency(balance)}</td>
                    {canWrite && settlement && (
                      <td className="py-2.5 px-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setPaymentTarget(settlement)}
                            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg cursor-pointer"
                          >
                            <Plus className="w-3 h-3" />
                            {balance < 0 ? t("finance.payroll.recordAdvance") : t("finance.payroll.recordPayment")}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={canWrite ? 7 : 6} className="px-3 pb-3">
                        <MemberPayrollBreakdown
                          memberId={member.id}
                          rate={rate}
                          settlement={settlement}
                          yearMonth={yearMonth}
                          payments={payments}
                          teacherCtx={teacherCtx}
                          memberNameById={memberNameById}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {paymentTarget && (
          <RecordPaymentModal settlement={paymentTarget} onClose={() => setPaymentTarget(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

function TeacherOwnPayrollView() {
  const { t, locale, formatDate } = useI18n();
  const settlementsQuery = useOwnTeacherSettlements(12);

  if (settlementsQuery.isLoading) return <LoadingState label={t("finance.payroll.loading")} />;
  if (settlementsQuery.isError) return <QueryErrorState error={settlementsQuery.error} />;

  const settlements = settlementsQuery.data ?? [];

  if (settlements.length === 0) {
    return (
      <p className="text-sm text-slate-400 py-8 text-center">{t("finance.payroll.ownEmpty")}</p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4">
      {settlements.map((settlement) => {
        const balance = settlementBalance(settlement);
        const periodLabel = formatMonthTitle(
          `${settlement.periodYear}-${String(settlement.periodMonth).padStart(2, "0")}`,
          locale
        );
        return (
          <div
            key={settlement.id}
            className="bg-slate-50 rounded-xl border border-slate-100 p-3.5 space-y-2"
          >
            <p className="text-sm font-semibold text-slate-800">{periodLabel}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-semibold">{t("finance.payroll.colAccrued")}</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">{formatCurrency(settlement.amountAccrued)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-semibold">{t("finance.payroll.colPaid")}</p>
                <p className="text-sm font-semibold text-emerald-700 mt-0.5">{formatCurrency(settlement.amountPaid)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-semibold">{t("finance.payroll.colBalance")}</p>
                <p className="text-sm font-semibold text-indigo-700 mt-0.5">{formatCurrency(balance)}</p>
              </div>
            </div>
            <p className="text-[10px] text-slate-400">
              {t("finance.payroll.computedAt", {
                date: formatDate(settlement.computedAt.slice(0, 10), {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                }),
              })}
            </p>
          </div>
        );
      })}
    </div>
  );
}

export default function FinancePayrollPage() {
  const { t, locale } = useI18n();
  const { can } = usePermissions();
  const isOwnView = can("payroll.read.own") && !can("payroll.read");
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const isCurrentMonth = yearMonth === currentYearMonth();

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("finance.payroll.title")}</h2>
          </div>
          {!isOwnView && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setYearMonth((m) => shiftMonth(m, -1))}
                className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label={t("subscriptions.aria.prevMonth")}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col items-center min-w-[8rem]">
                <span className="text-xs font-semibold text-slate-800">{formatMonthTitle(yearMonth, locale)}</span>
                {!isCurrentMonth && (
                  <button
                    type="button"
                    onClick={() => setYearMonth(currentYearMonth())}
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    {t("common.currentMonth")}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setYearMonth((m) => shiftMonth(m, 1))}
                className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label={t("subscriptions.aria.nextMonth")}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>

        {isOwnView ? <TeacherOwnPayrollView /> : <AdminPayrollTable yearMonth={yearMonth} />}
      </div>
    </div>
  );
}
