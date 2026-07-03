import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileCheck,
  History,
  Search,
  Send,
  Snowflake,
  Ticket,
  TicketPlus,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { Locale } from "../../i18n";
import { formatMoney, sellForm, subscriptionGroups, subscriptionHistory } from "../data";
import PageTabs, { pageTabPanelCls } from "../PageTabs";
import { crmStrings } from "../strings";
import { fieldCls, labelCls } from "../styles";

const checkboxCls = "rounded border-slate-300 text-indigo-600";

type Props = { locale: Locale; initialTab?: "active" | "sell" | "history" };

export function SubscriptionsPanel({ locale, initialTab = "active" }: Props) {
  const s = crmStrings(locale);
  const money = (n: number) => formatMoney(n, locale);
  const [tab, setTab] = useState(initialTab);
  const [expandedDisciplines, setExpandedDisciplines] = useState<Set<string>>(
    () => new Set(subscriptionGroups.map((g) => g.discipline))
  );
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);

  useEffect(() => setTab(initialTab), [initialTab]);

  const tabs = [
    { id: "active", label: s.subs.active, icon: FileCheck },
    { id: "sell", label: s.subs.sell, icon: TicketPlus },
    { id: "history", label: s.subs.history, icon: History },
  ];

  const toggleDiscipline = (name: string) => {
    setExpandedDisciplines((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div id="panel-subscriptions" className="panel-page-stack">
      <PageTabs tabs={tabs} activeTab={tab} onChange={setTab} />

      {tab === "active" && (
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack demo-field-disabled ${pageTabPanelCls("active", "active")}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-800">{s.subs.activeTitle}</h2>
              <p className="text-xs text-slate-400 mt-1">{s.subs.activeHint}</p>
            </div>
            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                disabled
                placeholder={s.subs.searchPlaceholder}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500"
              />
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <label className="block space-y-1">
              <span className={labelCls}>{s.subs.filterLocation}</span>
              <div className={fieldCls + " bg-white text-slate-600"}>{s.subs.filterAll}</div>
            </label>
            <label className="block space-y-1">
              <span className={labelCls}>{s.subs.filterDiscipline}</span>
              <div className={fieldCls + " bg-white text-slate-600"}>{s.subs.filterAllDisciplines}</div>
            </label>
            <label className="block space-y-1">
              <span className={labelCls}>{s.subs.filterGroups}</span>
              <div className={fieldCls + " bg-white text-slate-600"}>{s.subs.filterAllGroups}</div>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-2 lg:col-span-1 lg:self-end lg:pb-2">
              <input type="checkbox" disabled className={checkboxCls} />
              <span className="font-semibold">{s.subs.filterExpiring}</span>
            </label>
          </div>

          <div className="space-y-3">
            {subscriptionGroups.map((group) => {
              const isOpen = expandedDisciplines.has(group.discipline);
              return (
                <div key={group.discipline} className="border border-slate-200 rounded-xl overflow-hidden bg-white">
                  <button
                    type="button"
                    onClick={() => toggleDiscipline(group.discipline)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-800 truncate">{group.discipline}</h3>
                      <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                        {group.subs.length}{" "}
                        {group.subs.length === 1
                          ? locale === "ru"
                            ? "абонемент"
                            : "subscription"
                          : locale === "ru"
                            ? "абонемента"
                            : "subscriptions"}
                      </p>
                    </div>
                    <ChevronDown
                      className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {isOpen && (
                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-100">
                      {group.subs.map((sub) => {
                        const isExpanded = expandedSubId === sub.id;
                        const progressPct = (sub.left / sub.total) * 100;
                        const isAlarm = "alarm" in sub && sub.alarm;
                        return (
                          <div
                            key={sub.id}
                            className={`border rounded-xl bg-white transition-all ${
                              isExpanded
                                ? "border-indigo-200 shadow-sm p-5"
                                : "border-slate-200 p-4 hover:border-indigo-200 hover:shadow-sm"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => setExpandedSubId(isExpanded ? null : sub.id)}
                              className="w-full text-left cursor-pointer space-y-2"
                              aria-expanded={isExpanded}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="text-sm font-semibold text-slate-800 leading-tight min-w-0">{sub.client}</h3>
                                <ChevronDown
                                  className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-400">{s.subs.remainingLessons}</span>
                                  <span className="font-sans font-semibold text-slate-800">
                                    {sub.left} <span className="text-slate-400 font-normal">{s.subs.of} {sub.total}</span>
                                  </span>
                                </div>
                                <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full transition-all duration-300 ${isAlarm ? "bg-rose-500" : "bg-indigo-500"}`}
                                    style={{ width: `${progressPct}%` }}
                                  />
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1.5">
                                {sub.groups.map((g) => (
                                  <span
                                    key={g}
                                    className="text-[10px] font-sans font-semibold tracking-wide text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100"
                                  >
                                    {g}
                                  </span>
                                ))}
                              </div>
                            </button>

                            {isExpanded && (
                              <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
                                <div className="space-y-3">
                                  <p className="text-[11px] font-sans font-semibold text-indigo-700 leading-snug">{sub.tariff}</p>
                                  <p className="text-[11px] text-slate-400 font-sans">
                                    {s.subs.activated.replace("{date}", sub.activated)}
                                  </p>
                                  <p className="text-[11px] text-slate-400 font-sans">
                                    {s.subs.visits.replace("{visits}", String(sub.visits)).replace("{absences}", String(sub.absences))}
                                  </p>
                                  {sub.freezeAvailable ? (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-sans text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                                      <Snowflake className="w-3 h-3" /> {s.subs.freezeAvailable}
                                    </span>
                                  ) : null}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-sans text-[#1C82B4] bg-[#229ED9]/10 px-2 py-0.5 rounded">
                                    <Send className="w-3 h-3" /> Telegram
                                  </span>
                                </div>
                                <div className="flex items-center justify-between pt-1 text-xs">
                                  {isAlarm ? (
                                    <span className="text-rose-600 font-semibold">{s.subs.suggestRenewal}</span>
                                  ) : (
                                    <span className="text-slate-400">{s.subs.balanceOk}</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "sell" && (
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack panel-sell-under-tabs demo-field-disabled ${pageTabPanelCls("sell", "active")}`}
        >
          <div className="panel-form-header panel-form-header-wide-md">
            <div className="panel-form-header-icon">
              <Ticket className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="panel-form-header-text">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">{s.subs.sellTitle}</h2>
              <p className="text-slate-400 text-[11px] leading-snug">{s.subs.sellSubtitle}</p>
            </div>
          </div>

          <div className="panel-form-stack panel-form-stack-wide-md panel-form-stack-compact max-w-2xl">
            <label className="flex items-start gap-2 text-sm text-slate-700 panel-form-full-row-md">
              <input type="checkbox" disabled checked={sellForm.localPriceList} className={`${checkboxCls} mt-0.5`} />
              <span className="text-xs leading-snug">{s.subs.localPriceList}</span>
            </label>

            <div className="field-stack">
              <label className={labelCls}>{s.subs.tariffLabel}</label>
              <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2.5 flex justify-between text-sm">
                <span className="font-medium text-indigo-800">{sellForm.tariff}</span>
                <span className="font-semibold text-indigo-700">{money(sellForm.price)}</span>
              </div>
            </div>

            <div className="field-stack">
              <label className={labelCls}>{s.subs.client}</label>
              <div className={fieldCls + " bg-slate-50"}>{sellForm.client}</div>
            </div>

            <div className="field-stack">
              <label className={labelCls}>{s.subs.discipline}</label>
              <div className={fieldCls + " bg-slate-50"}>{sellForm.discipline}</div>
            </div>

            <div className="field-stack">
              <label className={labelCls}>{s.subs.groups}</label>
              <div className={fieldCls + " bg-slate-50"}>{sellForm.groups}</div>
            </div>

            <div className="field-stack">
              <label className={labelCls}>{s.subs.activation}</label>
              <div className={fieldCls + " bg-slate-50"}>{sellForm.activation}</div>
            </div>

            <div className="field-stack">
              <label className={labelCls}>{s.subs.payment}</label>
              <div className={fieldCls + " bg-slate-50"}>
                {sellForm.payment} · {money(sellForm.price)}
              </div>
            </div>

            <button
              type="button"
              disabled
              className="w-full py-3 bg-indigo-600/50 text-white text-sm font-semibold rounded-xl cursor-not-allowed mt-2 panel-form-full-row-md"
            >
              {s.subs.save}
            </button>
            <p className="text-center text-[10px] text-slate-400 panel-form-full-row-md">{s.subs.demoHint}</p>
          </div>
        </div>
      )}

      {tab === "history" && (
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack demo-field-disabled ${pageTabPanelCls("history", "active")}`}
        >
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-800">{s.subs.historyTitle}</h2>
            <p className="text-xs text-slate-400 mt-1">{s.subs.historyHint}</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block space-y-1">
              <span className={labelCls}>{s.subs.filterDiscipline}</span>
              <div className={fieldCls + " bg-slate-50 text-slate-600"}>Bachata</div>
            </label>
            <label className="block space-y-1">
              <span className={labelCls}>{s.subs.filterLocation}</span>
              <div className={fieldCls + " bg-slate-50 text-slate-600"}>{s.subs.filterAll}</div>
            </label>
            <label className="block space-y-1">
              <span className={labelCls}>{s.subs.client}</span>
              <div className={fieldCls + " bg-slate-50 text-slate-600"}>Marta Gómez</div>
            </label>
          </div>

          <div className="flex items-center justify-between px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50/50 gap-2">
            <button type="button" disabled className="p-1.5 rounded-lg text-slate-400">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">June 2026</span>
            <button type="button" disabled className="p-1.5 rounded-lg text-slate-400">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2">
            {subscriptionHistory.map((sub) => (
              <div
                key={sub.client + sub.activated}
                className="border border-slate-200 rounded-xl p-4 bg-white hover:border-indigo-200 transition-colors"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <h3 className="text-sm font-semibold text-slate-800">{sub.client}</h3>
                    <p className="text-[11px] font-sans font-semibold text-indigo-700">{sub.tariff}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-sans font-semibold tracking-wider uppercase text-slate-500">
                        {sub.discipline}
                      </span>
                      <span
                        className={`text-[10px] font-sans font-semibold px-2 py-0.5 rounded border ${
                          sub.finished
                            ? "text-slate-500 bg-slate-50 border-slate-200"
                            : "text-indigo-700 bg-indigo-50 border-indigo-100"
                        }`}
                      >
                        {sub.finished ? s.subs.statusFinished : s.subs.statusActive}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-0.5">
                    <p className="text-[11px] text-slate-400 font-sans">
                      {s.subs.activated.replace("{date}", sub.activated)}
                    </p>
                    <p className="text-xs font-sans font-semibold text-slate-700">
                      {sub.left} {s.subs.of} {sub.total}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
