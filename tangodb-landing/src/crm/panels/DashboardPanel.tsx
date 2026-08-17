import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Landmark,
  Ticket,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { useState } from "react";
import type { Locale } from "../../i18n";
import {
  activeSubsSummary,
  attendanceMonthStats,
  expiringSubs,
  financialStats,
  formatMoney,
  paymentByMethod,
  revenueSplit,
  revenueTrend,
  todayPayments,
  topClients,
  topTeachers,
  unpaidPersonal,
} from "../data";
import PageTabs, { pageTabPanelCls } from "../PageTabs";
import { crmStrings } from "../strings";

type Props = {
  locale: Locale;
  onNavigate: (panel: string) => void;
};

export function DashboardPanel({ locale, onNavigate }: Props) {
  const s = crmStrings(locale);
  const money = (n: number) => formatMoney(n, locale);
  const paymentCountLabel = (count: number) => {
    if (locale === "ru") {
      const mod10 = count % 10;
      const mod100 = count % 100;
      if (mod10 === 1 && mod100 !== 11) return `${count} ${s.dashboard.paymentOne}`;
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) {
        return `${count} ${s.dashboard.paymentFew}`;
      }
      return `${count} ${s.dashboard.paymentMany}`;
    }
    return count === 1 ? `1 ${s.dashboard.paymentOne}` : `${count} ${s.dashboard.paymentMany}`;
  };
  const paymentMethodLabel = (row: (typeof paymentByMethod)[number]) =>
    locale === "ru" ? row.methodRu : row.methodEn;
  const [tab, setTab] = useState<"operational" | "financial">("operational");
  const tabs = [
    { id: "operational", label: s.dashboard.operational, icon: BarChart3 },
    { id: "financial", label: s.dashboard.financial, icon: TrendingUp },
  ];

  return (
    <div className="panel-page-stack">
      <PageTabs tabs={tabs} activeTab={tab} onChange={setTab} />
      <div
        role="tabpanel"
        className={`bg-white p-4 border border-ink-200 shadow-xs panel-card-stack ${pageTabPanelCls(tab, "operational")}`}
      >
        {tab === "operational" ? (
          <div id="panel-dashboard" className="panel-page-stack">
            <div className="grid gap-3 grid-cols-2">
              <div
                className="bg-white rounded-xl px-3 py-2.5 border border-ink-200 shadow-xs cursor-pointer hover:shadow-sm transition-all min-w-0"
                onClick={() => onNavigate("subscriptions")}
                onKeyDown={() => {}}
                role="button"
                tabIndex={0}
              >
                <p className="text-[10px] text-ink-500 uppercase font-sans tracking-wider font-semibold leading-tight">
                  {s.dashboard.activeSubs}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 text-xl leading-none">
                  <Ticket className="text-gold-700 shrink-0 w-5 h-5" />
                  <h3 className="font-semibold text-ink-800">{activeSubsSummary.total}</h3>
                </div>
                <p className="text-[10px] text-ink-500 font-sans mt-0.5 leading-tight">
                  {s.dashboard.solosPairs
                    .replace("{solos}", String(activeSubsSummary.solos))
                    .replace("{pairs}", String(activeSubsSummary.pairs))}
                </p>
              </div>

              <div
                className="bg-white rounded-xl px-3 py-2.5 border border-ink-200 shadow-xs cursor-pointer hover:shadow-sm transition-all"
                onClick={() => onNavigate("personal")}
              >
                <p className="text-[10px] uppercase font-sans tracking-wider font-semibold leading-tight text-garnet-600">
                  {s.dashboard.debtorsPersonal}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5 text-xl leading-none text-garnet-600">
                  <AlertCircle className="shrink-0 w-5 h-5" />
                  <h3 className="font-sans font-semibold">
                    {unpaidPersonal.count} / {money(unpaidPersonal.amount)}
                  </h3>
                </div>
                <p className="text-[10px] font-sans mt-0.5 leading-tight text-garnet-600">{s.dashboard.unpaidLessons}</p>
              </div>
            </div>

            <div className="bg-white rounded-xl p-3.5 border border-ink-200 shadow-xs space-y-2">
              <div className="flex items-center justify-between border-b border-ink-100 pb-2">
                <div className="flex items-center gap-2 text-ink-800">
                  <BarChart3 className="w-4 h-4 text-gold-500" />
                  <h2 className="font-sans text-sm font-semibold tracking-tight">{s.dashboard.todayPayments}</h2>
                </div>
                <span className="text-[10px] font-sans uppercase bg-ink-100 text-ink-600 px-2 py-0.5 rounded font-semibold">
                  {todayPayments.length}
                </span>
              </div>
              <div className="space-y-1.5">
                {todayPayments.map((p) => (
                  <div
                    key={p.client}
                    className="flex items-center justify-between p-2 bg-ink-50 rounded-lg border border-ink-100 font-sans"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink-800 truncate">{p.client}</p>
                      <p className="text-[10px] text-ink-500">
                        {p.source} · {p.method}
                      </p>
                    </div>
                    <span className="text-xs font-semibold text-gold-700 shrink-0">{money(p.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white rounded-xl p-3.5 border border-ink-200 shadow-xs space-y-2">
                <div className="flex items-center justify-between border-b border-ink-100 pb-2">
                  <h2 className="font-sans text-sm font-semibold text-ink-800 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-garnet-600" />
                    {s.dashboard.expiringSubs.replace("{n}", "2")}
                  </h2>
                  <span className="text-[10px] font-sans px-2 py-0.5 rounded font-semibold tabular-nums bg-garnet-50 text-garnet-700">
                    {expiringSubs.length}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
                  {expiringSubs.map((sub) => (
                    <div key={sub.client} className="p-2 bg-ink-50 rounded-lg border border-ink-100 space-y-1">
                      <p className="font-sans font-semibold text-ink-800 text-xs">{sub.client}</p>
                      <p className="text-[10px] font-sans text-ink-500">
                        {s.dashboard.balance}{" "}
                        <span className="font-semibold text-garnet-700">{sub.left}</span>
                        <span className="text-ink-400"> / {sub.total}</span>
                        {" · "}
                        {sub.discipline}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white rounded-xl p-3.5 border border-ink-200 shadow-xs space-y-2">
                <div className="flex items-center justify-between gap-2 border-b border-ink-100 pb-2">
                  <h2 className="font-sans text-sm font-semibold text-ink-800 flex items-center gap-2">
                    <ClipboardCheck className="w-4 h-4 text-gold-500" />
                    {s.dashboard.attendance}
                  </h2>
                  <span className="text-xs font-semibold text-ink-800">June 2026</span>
                </div>
                <div className="grid grid-cols-3 gap-px bg-ink-200/10 rounded-lg overflow-hidden border border-ink-200">
                  <div className="bg-white px-3 py-2.5 text-center">
                    <p className="text-[10px] text-ink-500 uppercase font-semibold">{s.dashboard.present}</p>
                    <p className="text-lg font-semibold text-gold-700 mt-0.5">{attendanceMonthStats.present}</p>
                  </div>
                  <div className="bg-white px-3 py-2.5 text-center">
                    <p className="text-[10px] text-ink-500 uppercase font-semibold">{s.dashboard.absences}</p>
                    <p className="text-lg font-semibold text-garnet-600 mt-0.5">{attendanceMonthStats.absent}</p>
                  </div>
                  <div className="bg-white px-3 py-2.5 text-center">
                    <p className="text-[10px] text-ink-500 uppercase font-semibold">{s.dashboard.freeze}</p>
                    <p className="text-lg font-semibold text-ink-800 mt-0.5">{attendanceMonthStats.freeze}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onNavigate("attendance")}
                  className="w-full text-center py-2 border border-dashed border-ink-300 hover:border-ink-400 rounded-lg text-ink-500 text-[11px] font-sans hover:bg-ink-50 transition-colors uppercase tracking-wider font-semibold cursor-pointer"
                >
                  {s.dashboard.openAttendance}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div id="panel-dashboard" className="panel-page-stack">
            <div className="bg-white rounded-xl p-3.5 border border-ink-200 shadow-xs space-y-3">
              <div className="flex items-center justify-between gap-2 border-b border-ink-100 pb-2">
                <h2 className="font-sans text-sm font-semibold text-ink-800 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-gold-500" />
                  {s.dashboard.financialOverview}
                </h2>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="p-1 rounded-lg hover:bg-ink-50 text-ink-500 hover:text-ink-800 transition-colors cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex flex-col items-center min-w-0">
                    <span className="text-xs font-semibold text-ink-800">{s.dashboard.monthTitle}</span>
                    <span className="text-[10px] font-semibold text-gold-700 whitespace-nowrap">
                      {s.dashboard.currentMonth}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="p-1 rounded-lg hover:bg-ink-50 text-ink-500 hover:text-ink-800 transition-colors cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.revenue}</p>
                  <p className="text-xl font-semibold text-ink-900 mt-0.5">{money(financialStats.revenue)}</p>
                  {financialStats.mom !== null && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <ArrowUp className="w-3 h-3 text-gold-700" />
                      <p className="text-[10px] font-semibold text-gold-700">
                        {s.dashboard.mom.replace("{n}", String(financialStats.mom))}
                      </p>
                      <span className="text-[10px] text-ink-500">{s.dashboard.momVsPrevious}</span>
                    </div>
                  )}
                  <p className="text-[10px] text-ink-500 mt-0.5">{paymentCountLabel(financialStats.paymentCount)}</p>
                </div>
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.subscriptions}</p>
                  <p className="text-xl font-semibold text-gold-700 mt-0.5">{money(financialStats.subscriptions)}</p>
                </div>
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.personal}</p>
                  <p className="text-xl font-semibold text-gold-700 mt-0.5">{money(financialStats.personal)}</p>
                </div>
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.singleVisits}</p>
                  <p className="text-xl font-semibold text-gold-700 mt-0.5">{money(financialStats.singleVisits)}</p>
                </div>
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.receivables}</p>
                  <p className="text-xl font-semibold text-garnet-700 mt-0.5">{money(financialStats.receivables)}</p>
                  <p className="text-[10px] text-ink-500 mt-0.5">
                    {s.dashboard.receivablesBreakdown
                      .replace("{subs}", String(financialStats.receivablesSubs))
                      .replace("{personal}", String(financialStats.receivablesPersonal))}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 pt-1 border-t border-ink-100">
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.expensesMonth}</p>
                  <p className="text-xl font-semibold text-garnet-700 mt-0.5">{money(financialStats.expenses)}</p>
                </div>
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.payrollAccrued}</p>
                  <p className="text-xl font-semibold text-ink-700 mt-0.5">{money(financialStats.payroll)}</p>
                  <p className="text-[10px] text-ink-500 mt-0.5">{s.dashboard.payrollAccruedHint}</p>
                </div>
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100 col-span-2 lg:col-span-1">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.profit}</p>
                  <p className="text-xl font-semibold text-gold-700 mt-0.5">{money(financialStats.profit)}</p>
                  <p className="text-[10px] text-ink-500 mt-0.5">{s.dashboard.profitHint}</p>
                </div>
              </div>

              {paymentByMethod.some((row) => row.amount > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {paymentByMethod
                    .filter((row) => row.amount > 0)
                    .map((row) => (
                      <div
                        key={row.methodRu}
                        className="flex items-center justify-between px-3 py-2 rounded-lg border border-ink-100 text-xs font-sans"
                      >
                        <span className="text-ink-500">{paymentMethodLabel(row)}</span>
                        <span className="font-semibold text-ink-800">{money(row.amount)}</span>
                      </div>
                    ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 pt-1 border-t border-ink-100 lg:grid-cols-[minmax(0,65fr)_minmax(0,35fr)]">
                <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-2 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.revenueTrend}</p>
                    <div className="h-8 px-2 flex items-center rounded-lg border border-ink-200 bg-white text-[11px] text-ink-600">
                      {s.dashboard.revenueTrendPeriod}
                    </div>
                  </div>
                  <div className="flex items-end gap-1.5 h-24 px-1">
                    {revenueTrend.map((val, i) => (
                      <div key={i} className="flex-1 flex flex-col justify-end h-full min-w-0">
                        <div
                          className="rounded-t bg-gold-400/10 w-full mx-auto max-w-[28px]"
                          style={{ height: `${(val / 12480) * 100}%` }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-2">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{s.dashboard.revenueSplit}</p>
                  <div className="space-y-2 pt-1">
                    {revenueSplit.map((seg) => {
                      const label =
                        seg.key === "subscription"
                          ? s.dashboard.subscriptions
                          : seg.key === "personal"
                            ? s.dashboard.personal
                            : s.dashboard.singleVisits;
                      return (
                      <div key={seg.key} className="space-y-1">
                        <div className="flex justify-between text-[11px]">
                          <span className="text-ink-600">{label}</span>
                          <span className="font-semibold text-ink-800">{seg.pct}%</span>
                        </div>
                        <div className="h-1.5 bg-ink-200 rounded-full overflow-hidden">
                          <div className="h-full bg-gold-500 rounded-full" style={{ width: `${seg.pct}%` }} />
                        </div>
                      </div>
                    );})}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-1 border-t border-ink-100">
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider flex items-center gap-1">
                    <UserPlus className="w-3 h-3" />
                    {s.dashboard.newClients}
                  </p>
                  <p className="text-xl font-semibold text-ink-900 mt-0.5">{financialStats.newClients}</p>
                  <p className="text-[10px] text-ink-500 mt-0.5">{s.dashboard.newClientsInMonth}</p>
                </div>
                <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100 col-span-1 lg:col-span-1">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider flex items-center gap-1">
                    <ClipboardCheck className="w-3 h-3" />
                    {s.dashboard.occupancy}
                  </p>
                  <p className="text-xl font-semibold text-gold-700 mt-0.5">{financialStats.occupancy}%</p>
                  <p className="text-[10px] text-ink-500 mt-0.5">
                    {s.dashboard.occupancyDetail
                      .replace("{present}", String(financialStats.occupancyPresent))
                      .replace("{absent}", String(financialStats.occupancyAbsent))}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1 border-t border-ink-100">
                <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-2">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider flex items-center gap-1">
                    <Users className="w-3 h-3" />
                    {s.dashboard.topClients}
                  </p>
                  <div className="space-y-1.5">
                    {topClients.map((c, i) => (
                      <div key={c.name} className="flex items-center justify-between text-xs px-2 py-1.5 bg-white rounded-lg border border-ink-100">
                        <span className="text-ink-700">
                          <span className="text-ink-400 mr-1.5">{i + 1}.</span>
                          {c.name}
                        </span>
                        <span className="font-semibold text-gold-700">{money(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-ink-100 bg-ink-50/10 p-3 space-y-2">
                  <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider flex items-center gap-1">
                    <GraduationCap className="w-3 h-3" />
                    {s.dashboard.topTeachers}
                  </p>
                  <div className="space-y-1.5">
                    {topTeachers.map((c, i) => (
                      <div key={c.name} className="flex items-center justify-between text-xs px-2 py-1.5 bg-white rounded-lg border border-ink-100">
                        <span className="text-ink-700">
                          <span className="text-ink-400 mr-1.5">{i + 1}.</span>
                          {c.name}
                        </span>
                        <span className="font-semibold text-gold-700">{money(c.amount)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[
                { icon: TrendingUp, color: "text-gold-500", title: s.dashboard.financeLinksRevenue, sub: s.dashboard.financeLinksRevenueDetail },
                { icon: AlertCircle, color: "text-garnet-600", title: s.dashboard.financeLinksDebtors, sub: "3 records" },
                { icon: Landmark, color: "text-gold-500", title: s.dashboard.financeLinksPayments, sub: s.dashboard.financeLinksFullHistory },
              ].map(({ icon: Icon, color, title, sub }) => (
                <div
                  key={title}
                  className="bg-white rounded-xl px-3 py-3 border border-ink-200 shadow-xs text-left"
                >
                  <div className="flex items-center justify-between">
                    <Icon className={`w-4 h-4 ${color}`} />
                    <ArrowRight className="w-3.5 h-3.5 text-ink-400" />
                  </div>
                  <p className="text-xs font-semibold text-ink-800 mt-2">{title}</p>
                  <p className="text-[10px] text-ink-500 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
