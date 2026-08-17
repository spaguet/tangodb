import { AlertCircle, Landmark, Receipt, TrendingUp, Wallet, Search } from "lucide-react";
import { useState } from "react";
import type { Locale } from "../../i18n";
import { CrmSubNav } from "../components/CrmSubNav";
import {
  debtors,
  expenses,
  financialStats,
  formatMoney,
  paymentJournal,
  payrollRows,
} from "../data";
import { panelStrings } from "../panelStrings";

type Tab = "payments" | "revenue" | "debtors" | "expenses" | "payroll";

type Props = { locale: Locale };

export function FinancePanel({ locale }: Props) {
  const p = panelStrings(locale);
  const money = (n: number) => formatMoney(n, locale);
  const [tab, setTab] = useState<Tab>("payments");

  const nav = [
    { id: "payments", label: p.financePayments, icon: Landmark },
    { id: "revenue", label: p.financeRevenue, icon: TrendingUp },
    { id: "debtors", label: p.financeDebtors, icon: AlertCircle },
    { id: "expenses", label: p.financeExpenses, icon: Receipt },
    { id: "payroll", label: p.financePayroll, icon: Wallet },
  ];

  return (
    <div className="flex flex-col gap-5 demo-field-disabled">
      <CrmSubNav title={p.financeNav} items={nav} active={tab} onChange={(id) => setTab(id as Tab)} />

      {tab === "payments" && (
        <div className="bg-white rounded-xl border border-ink-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Landmark className="w-4 h-4 text-gold-500" />
              <h2 className="font-sans text-sm font-semibold text-ink-800">{p.paymentsTitle}</h2>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-4 h-4 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input disabled value="" placeholder={p.search} className="w-full pl-9 pr-3 py-2 text-xs border border-ink-200 rounded-lg bg-ink-50" />
            </div>
          </div>
          <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-3 py-2 bg-ink-50 border-b border-ink-100 text-[10px] uppercase tracking-wider font-semibold text-ink-500">
            <span>{p.client}</span>
            <span>{p.source}</span>
            <span>{p.method}</span>
            <span className="text-right">{p.amount}</span>
          </div>
          {paymentJournal.map((row) => (
            <div
              key={row.date + row.client}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:gap-3 items-center px-3 py-3 border-b border-ink-100 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-800 truncate">{row.client}</p>
                <p className="text-[10px] text-ink-500 mt-0.5">{row.date}</p>
              </div>
              <p className="text-xs text-ink-500 hidden sm:block">{row.source}</p>
              <p className="text-xs text-ink-500 hidden sm:block">{row.method}</p>
              <p className="text-sm font-semibold text-gold-700 text-right">{money(row.amount)}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "revenue" && (
        <div className="bg-white rounded-xl border border-ink-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-gold-500" />
              <h2 className="font-sans text-sm font-semibold text-ink-800">{p.revenueTitle}</h2>
            </div>
            <span className="text-xs font-semibold text-ink-800">June 2026</span>
          </div>
          <div className="p-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100 col-span-2 lg:col-span-1">
              <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{p.revenueTotal}</p>
              <p className="text-lg font-semibold text-ink-900 mt-0.5">{money(financialStats.revenue)}</p>
              <p className="text-[10px] text-ink-500 mt-0.5">{paymentJournal.length} {p.paymentsCount}</p>
            </div>
            <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
              <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{locale === "ru" ? "Абонементы" : "Subscriptions"}</p>
              <p className="text-lg font-semibold text-gold-700 mt-0.5">{money(financialStats.subscriptions)}</p>
            </div>
            <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
              <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{locale === "ru" ? "Персональные" : "Private"}</p>
              <p className="text-lg font-semibold text-gold-700 mt-0.5">{money(financialStats.personal)}</p>
            </div>
            <div className="bg-ink-50 rounded-lg px-3 py-2.5 border border-ink-100">
              <p className="text-[10px] text-ink-500 uppercase font-semibold tracking-wider">{locale === "ru" ? "Разовые" : "Drop-in"}</p>
              <p className="text-lg font-semibold text-gold-700 mt-0.5">{money(financialStats.singleVisits)}</p>
            </div>
          </div>
        </div>
      )}

      {tab === "debtors" && (
        <div className="bg-white rounded-xl border border-ink-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100 flex justify-between items-center">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-garnet-600" />
              <h2 className="font-sans text-sm font-semibold text-ink-800">{p.debtorsTitle}</h2>
            </div>
            <span className="text-sm font-semibold text-garnet-700">{p.debtorsToPay}: {money(115)}</span>
          </div>
          <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 px-3 py-2 bg-ink-50 border-b border-ink-100 text-[10px] uppercase tracking-wider font-semibold text-ink-500">
            <span>{p.client}</span>
            <span>{p.telegramCol}</span>
            <span>{p.details}</span>
            <span className="text-right">{p.amount}</span>
          </div>
          {debtors.map((d) => (
            <div
              key={d.client}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:gap-3 items-center px-3 py-3 border-b border-ink-100 last:border-b-0"
            >
              <p className="text-sm font-semibold text-ink-800 truncate">{d.client}</p>
              <p className="text-xs text-ink-500 hidden sm:block">{d.contact}</p>
              <p className="text-xs text-ink-500 hidden sm:block">{d.detail}</p>
              <p className="text-sm font-semibold text-right text-garnet-700">{d.amount > 0 ? money(d.amount) : "—"}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "expenses" && (
        <div className="bg-white rounded-xl border border-ink-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100 flex items-center gap-2">
            <Receipt className="w-4 h-4 text-gold-500" />
            <h2 className="font-sans text-sm font-semibold text-ink-800">{p.expensesTitle}</h2>
          </div>
          {expenses.map((e) => (
            <div
              key={e.description}
              className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:gap-3 items-center px-3 py-3 border-b border-ink-100 last:border-b-0"
            >
              <div>
                <p className="text-sm font-semibold text-ink-800">{e.description}</p>
                <p className="text-[10px] text-ink-500">{e.date}</p>
              </div>
              <p className="text-xs text-ink-500 hidden sm:block">{e.category}</p>
              <p className="text-sm font-semibold text-garnet-700 text-right">{money(e.amount)}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "payroll" && (
        <div className="bg-white rounded-xl border border-ink-200 shadow-xs overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-100 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-gold-500" />
            <h2 className="font-sans text-sm font-semibold text-ink-800">{p.payrollTitle}</h2>
            <span className="text-xs text-ink-500 ml-auto">June 2026</span>
          </div>
          <div className="hidden sm:grid sm:grid-cols-4 gap-3 px-3 py-2 bg-ink-50 border-b border-ink-100 text-[10px] uppercase tracking-wider font-semibold text-ink-500">
            <span>{locale === "ru" ? "Преподаватель" : "Teacher"}</span>
            <span>{p.accrued}</span>
            <span>{p.paid}</span>
            <span className="text-right">{p.balance}</span>
          </div>
          {payrollRows.map((row) => (
            <div
              key={row.name}
              className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 items-center px-3 py-3 border-b border-ink-100 last:border-b-0"
            >
              <div>
                <p className="text-sm font-semibold text-ink-800">{row.name}</p>
                <p className="text-[10px] text-ink-500">{row.role}</p>
              </div>
              <p className="text-sm text-ink-700">{money(row.accrued)}</p>
              <p className="text-sm text-ink-700">{money(row.paid)}</p>
              <p className={`text-sm font-semibold text-right ${row.balance > 0 ? "text-amber-700" : "text-ink-500"}`}>
                {money(row.balance)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
