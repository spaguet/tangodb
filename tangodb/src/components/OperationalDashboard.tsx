import { useMemo, useState } from "react";
import { motion } from "motion/react";
import {
  Ticket,
  AlertCircle,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Send,
  ClipboardCheck,
} from "lucide-react";
import {
  formatClientName,
  formatCurrency,
  currentYearMonth,
  formatMonthTitle,
  getSubscriptionDaysLeft,
  isMonthlyUnlimitedSubscription,
} from "../lib/utils";
import { normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { shiftMonth } from "../lib/financeReports";
import { useI18n } from "../hooks/useI18n";
import type { Client, Payment, PersonalLesson, Subscription } from "../types";
import { PAYMENT_METHODS, getPaymentMethodLabel, paymentSourceLabel } from "../hooks/usePayments";
import { useAttendanceRecords } from "../hooks/useAttendance";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePersonalLessonsModuleEnabled } from "../hooks/useOrgModules";

interface OperationalDashboardProps {
  clients: Client[];
  subscriptions: Subscription[];
  personalLessons: PersonalLesson[];
  todayPayments?: Payment[];
  showOperationalPayments?: boolean;
  onNavigate: (panel: string) => void;
}

export default function OperationalDashboard({
  clients,
  subscriptions,
  personalLessons,
  todayPayments = [],
  showOperationalPayments = false,
  onNavigate,
}: OperationalDashboardProps) {
  const { t, locale, plural } = useI18n();
  const { settings } = useOrganization();
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const lowBalanceThreshold = settings?.low_balance_threshold ?? 2;
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const isViewingCurrentMonth = statsMonth === currentYearMonth();
  const attendanceQuery = useAttendanceRecords(statsMonth);

  const activeSubs = subscriptions.filter((s) => s.status === "active");
  const solosCount = activeSubs.filter((s) => s.type === "solo").length;
  const pairsCount = activeSubs.filter((s) => s.type === "pair" || s.type === "pair_hm").length;
  const warningSubs = activeSubs.filter((s) => {
    if (isMonthlyUnlimitedSubscription(s)) {
      return getSubscriptionDaysLeft(s.expiresAt) <= lowBalanceThreshold;
    }
    return s.lessonsLeft <= lowBalanceThreshold;
  });

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c])) as Record<string, Client>,
    [clients]
  );

  const unpaidLessons = personalLessons.filter((l) => l.paid === "no");
  const pendingUnpaidCount = unpaidLessons.length;
  const pendingRevenue = unpaidLessons.reduce((sum, l) => sum + l.price, 0);
  const hasPendingPayment = pendingUnpaidCount > 0;
  const pendingPaymentColor = hasPendingPayment ? "text-rose-600" : "text-slate-400";

  const attendanceStats = useMemo(() => {
    const records = attendanceQuery.data ?? [];
    let present = 0;
    let absent = 0;
    let freeze = 0;
    for (const record of records) {
      if (record.attendanceStatus === "present") present += 1;
      else if (record.attendanceStatus === "absent") absent += 1;
      else if (record.attendanceStatus === "freeze") freeze += 1;
    }
    return { present, absent, freeze, total: present + absent + freeze };
  }, [attendanceQuery.data]);

  return (
    <div id="panel-dashboard" className="panel-page-stack">
      <div className="space-y-3">
        <div className={`grid gap-3 ${personalLessonsEnabled ? "grid-cols-2" : "grid-cols-1"}`}>
          <motion.div
            whileHover={{ y: -2 }}
            className="bg-white rounded-xl px-3 py-2.5 border border-slate-200/90 shadow-xs cursor-pointer hover:shadow-sm transition-all min-w-0"
            onClick={() => onNavigate("activeSubs")}
          >
            <p className="text-[10px] text-slate-400 uppercase font-sans tracking-wider font-semibold leading-tight">
              {t("dashboard.activeSubs")}
            </p>
            <div className="flex items-center gap-1.5 mt-0.5 text-xl leading-none">
              <Ticket className="text-indigo-600 shrink-0 w-5 h-5" />
              <h3 className="font-semibold text-slate-800">{activeSubs.length}</h3>
            </div>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5 leading-tight">
              {t("dashboard.solosPairs", { solos: solosCount, pairs: pairsCount })}
            </p>
          </motion.div>

          {personalLessonsEnabled ? (
            <motion.div
              whileHover={{ y: -2 }}
              className="bg-white rounded-xl px-3 py-2.5 border border-slate-200/90 shadow-xs cursor-pointer hover:shadow-sm transition-all"
              onClick={() => onNavigate("personalView")}
            >
              <p className={`text-[10px] uppercase font-sans tracking-wider font-semibold leading-tight ${pendingPaymentColor}`}>
                {t("dashboard.debtorsPersonal")}
              </p>
              <div className={`flex items-center gap-1.5 mt-0.5 text-xl leading-none ${pendingPaymentColor}`}>
                <AlertCircle className="shrink-0 w-5 h-5" />
                <h3 className="font-sans font-semibold">
                  {pendingUnpaidCount} / {formatCurrency(pendingRevenue)}
                </h3>
              </div>
              <p className={`text-[10px] font-sans mt-0.5 leading-tight ${pendingPaymentColor}`}>
                {t("dashboard.unpaidLessons")}
              </p>
            </motion.div>
          ) : null}
        </div>
      </div>

      {showOperationalPayments && (
        <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2 text-slate-800">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              <h2 className="font-sans text-sm font-semibold tracking-tight">{t("dashboard.todayPayments")}</h2>
            </div>
            <span className="text-[10px] font-sans uppercase bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-semibold">
              {todayPayments.length}
            </span>
          </div>
          {todayPayments.length === 0 ? (
            <p className="text-slate-400 text-xs font-sans py-3 text-center">{t("dashboard.noPaymentsToday")}</p>
          ) : (
            <div className="space-y-1.5">
              {todayPayments.slice(0, 8).map((payment) => (
                <div
                  key={payment.id}
                  className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 font-sans"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">{payment.clientDisplay}</p>
                    <p className="text-[10px] text-slate-400">
                      {paymentSourceLabel(payment, t)} · {getPaymentMethodLabel(payment.method, t)}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-indigo-700 shrink-0">
                    {formatCurrency(payment.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${warningSubs.length === 0 ? "bg-slate-400" : "bg-rose-600"}`}
              />
              {t("dashboard.expiringSubs", { threshold: lowBalanceThreshold })}
            </h2>
            <span
              className={`text-[10px] font-sans px-2 py-0.5 rounded font-semibold tabular-nums ${
                warningSubs.length === 0 ? "bg-slate-100 text-slate-400" : "bg-rose-50 text-rose-700"
              }`}
            >
              {warningSubs.length}
            </span>
          </div>

          {warningSubs.length === 0 ? (
            <div className="text-center py-5 text-slate-400">
              <p className="text-xs">{t("dashboard.noExpiringSubs")}</p>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
              {warningSubs.map((sub) => {
                const c1 = clientMap[sub.clientId1];
                const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
                const c3 = sub.clientId3 ? clientMap[sub.clientId3] : null;
                const clientLabel = c1
                  ? [c1, c2, c3]
                      .filter(Boolean)
                      .map((c) => formatClientName(c!.lastName, c!.firstName))
                      .join(" & ")
                  : sub.clientId1;

                return (
                  <div key={sub.id} className="p-2 bg-slate-50 rounded-lg border border-slate-100 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-sans font-semibold text-slate-800 text-xs min-w-0 truncate">{clientLabel}</p>
                      <div className="flex items-center gap-1 shrink-0">
                        {[c1, c2, c3].map((c) => {
                          if (!c?.telegram) return null;
                          const tgUrl = normalizeTelegramContact(c.telegram);
                          if (!tgUrl) return null;
                          return (
                            <a
                              key={c.id}
                              href={tgUrl}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => {
                                e.preventDefault();
                                openTelegramContact(c.telegram);
                              }}
                              className="inline-flex items-center justify-center p-1 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md transition-colors"
                              title={t("dashboard.telegramWrite", { name: c.firstName })}
                              aria-label={t("dashboard.telegramWrite", { name: c.firstName })}
                            >
                              <Send className="w-3.5 h-3.5" />
                            </a>
                          );
                        })}
                      </div>
                    </div>
                    <p className="text-[10px] font-sans text-slate-500">
                      {isMonthlyUnlimitedSubscription(sub) ? (
                        <>
                          {t("dashboard.remainingDays")}{" "}
                          <span className="font-semibold text-rose-700">
                            {getSubscriptionDaysLeft(sub.expiresAt)}
                          </span>
                          <span className="text-slate-400">
                            {" "}
                            {t("common.of")} 30 {plural(30, [t("common.day.one"), t("common.day.few"), t("common.day.many")])}
                          </span>
                        </>
                      ) : (
                        <>
                          {t("dashboard.balance")}{" "}
                          <span className="font-semibold text-rose-700">{sub.lessonsLeft}</span>
                          <span className="text-slate-400"> {t("common.of")} {sub.lessonsTotal}</span>
                        </>
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
              <ClipboardCheck className="w-4 h-4 text-indigo-500" />
              {t("dashboard.attendance")}
            </h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setStatsMonth((m) => shiftMonth(m, -1))}
                className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label={t("subscriptions.aria.prevMonth")}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col items-center min-w-0">
                <span className="text-xs font-semibold text-slate-800">{formatMonthTitle(statsMonth, locale)}</span>
                {!isViewingCurrentMonth && (
                  <button
                    type="button"
                    onClick={() => setStatsMonth(currentYearMonth())}
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    {t("common.currentMonth")}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setStatsMonth((m) => shiftMonth(m, 1))}
                className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label={t("subscriptions.aria.nextMonth")}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-px bg-slate-200/70 rounded-lg overflow-hidden border border-slate-200/70">
            <div className="bg-white px-3 py-2.5 text-center">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">{t("dashboard.present")}</p>
              <p className="text-lg font-semibold text-indigo-700 mt-0.5">{attendanceStats.present}</p>
            </div>
            <div className="bg-white px-3 py-2.5 text-center">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">{t("dashboard.absences")}</p>
              <p className="text-lg font-semibold text-rose-600 mt-0.5">{attendanceStats.absent}</p>
            </div>
            <div className="bg-white px-3 py-2.5 text-center">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">{t("dashboard.freeze")}</p>
              <p className="text-lg font-semibold text-slate-800 mt-0.5">{attendanceStats.freeze}</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onNavigate("attendance")}
            className="w-full text-center py-2 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-500 text-[11px] font-sans hover:bg-slate-50 transition-colors uppercase tracking-wider font-semibold cursor-pointer"
          >
            {t("dashboard.openAttendance")}
          </button>
        </div>
      </div>
    </div>
  );
}
