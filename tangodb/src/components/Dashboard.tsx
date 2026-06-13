/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";
import { Users, Ticket, Calendar, AlertCircle, Send, BarChart3 } from "lucide-react";
import { formatClientName, formatCurrency, formatPairName, dowFull, jsDayToIsoDow, currentYearMonth, isDateInYearMonth, getSubscriptionPrice } from "../lib/utils";
import { normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { computeScheduleDatesForMonth } from "../hooks/useAttendance";
import { Client, Subscription, ScheduleSlot, PersonalLesson, Price } from "../types";

interface DashboardProps {
  clients: Client[];
  subscriptions: Subscription[];
  schedule: ScheduleSlot[];
  personalLessons: PersonalLesson[];
  prices: Price[];
  onNavigate: (panel: string) => void;
}

export default function Dashboard({
  clients,
  subscriptions,
  schedule,
  personalLessons,
  prices,
  onNavigate,
}: DashboardProps) {
  const activeSubs = subscriptions.filter((s) => s.status === "active");
  const solosCount = activeSubs.filter((s) => s.type === "solo").length;
  const pairsCount = activeSubs.filter((s) => s.type === "pair" || s.type === "pair_hm").length;

  // Warning memberships logic (<= 2 credits remaining)
  const warningSubs = activeSubs.filter((s) => s.lessonsLeft <= 2);

  const clientMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {} as Record<string, Client>);

  const unpaidLessons = personalLessons.filter((l) => l.paid === "no");
  const pendingUnpaidCount = unpaidLessons.length;
  const pendingRevenue = unpaidLessons.reduce((sum, l) => sum + l.price, 0);
  const hasPendingPayment = pendingUnpaidCount > 0 && pendingRevenue > 0;
  const pendingPaymentColor = hasPendingPayment ? "text-rose-600" : "text-slate-400";

  const todayIsoDow = jsDayToIsoDow(new Date().getDay());
  const todaySlots = schedule.filter((s) => s.dayOfWeek === todayIsoDow);

  const yearMonth = currentYearMonth();
  const monthGroupLessons = computeScheduleDatesForMonth(schedule, yearMonth).length;
  const monthSoldSubs = subscriptions.filter((s) => isDateInYearMonth(s.activationDate, yearMonth));
  const monthSubsRevenue = monthSoldSubs.reduce((sum, s) => sum + getSubscriptionPrice(s, prices), 0);
  const monthPersonalLessons = personalLessons.filter((l) => isDateInYearMonth(l.date, yearMonth));
  const monthPersonalCount = monthPersonalLessons.length;
  const monthPersonalPaidSum = monthPersonalLessons
    .filter((l) => l.paid === "yes")
    .reduce((sum, l) => sum + l.price, 0);
  const monthTotalRevenue = monthSubsRevenue + monthPersonalPaidSum;

  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long" }).format(new Date());

  return (
    <div id="panel-dashboard" className="panel-page-stack">
      {/* Statistics widgets */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <motion.div
            whileHover={{ y: -2 }}
            className="bg-white rounded-xl px-3 py-2.5 border border-slate-200/90 shadow-xs cursor-pointer hover:shadow-sm transition-all min-w-0"
            onClick={() => onNavigate("activeSubs")}
          >
            <p className="text-[10px] text-slate-400 uppercase font-sans tracking-wider font-semibold leading-tight">
              Абонементы
            </p>
            <div className="flex items-center gap-1.5 mt-0.5 text-xl leading-none">
              <Ticket className="text-indigo-600 shrink-0 w-[1em] h-[1em]" />
              <h3 className="font-semibold text-slate-800">{activeSubs.length}</h3>
            </div>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5 leading-tight">
              <span className="text-indigo-600 font-semibold">{solosCount}</span> соло ·{" "}
              <span className="text-indigo-600 font-semibold">{pairsCount}</span> парных
            </p>
          </motion.div>

          <motion.div
            whileHover={{ y: -2 }}
            className="bg-white rounded-xl px-3 py-2.5 border border-slate-200/90 shadow-xs cursor-pointer hover:shadow-sm transition-all min-w-0"
            onClick={() => onNavigate("newClient")}
          >
            <p className="text-[10px] text-slate-400 uppercase font-sans tracking-wider font-semibold leading-tight">
              Всего клиентов
            </p>
            <div className="flex items-center gap-1.5 mt-0.5 text-xl leading-none">
              <Users className="text-indigo-600 shrink-0 w-[1em] h-[1em]" />
              <h3 className="font-semibold text-slate-800">{clients.length}</h3>
            </div>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5 leading-tight">карточек в реестре</p>
          </motion.div>
        </div>

        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white rounded-xl px-3 py-2.5 border border-slate-200/90 shadow-xs cursor-pointer hover:shadow-sm transition-all"
          onClick={() => onNavigate("personalView")}
        >
          <p className={`text-[10px] uppercase font-sans tracking-wider font-semibold leading-tight ${pendingPaymentColor}`}>
            Ожидает оплаты
          </p>
          <div className={`flex items-center gap-1.5 mt-0.5 text-xl leading-none ${pendingPaymentColor}`}>
            <AlertCircle className="shrink-0 w-[1em] h-[1em]" />
            <h3 className="font-sans font-semibold">
              {pendingUnpaidCount} / {formatCurrency(pendingRevenue)}
            </h3>
          </div>
          <p className={`text-[10px] font-sans mt-0.5 font-normal leading-tight ${pendingPaymentColor}`}>
            из персональных уроков
          </p>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Today Schedule section */}
        <div className="lg:col-span-5 bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2 text-slate-800">
              <Calendar className="w-4 h-4 text-indigo-500" />
              <h2 className="font-sans text-sm font-semibold tracking-tight">Расписание на сегодня</h2>
            </div>
            <span className="text-[10px] font-sans uppercase bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-semibold">
              {dowFull(todayIsoDow)}
            </span>
          </div>

          <div className="space-y-1.5 pt-0.5">
            {todaySlots.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-slate-400 text-xs font-sans">Сегодня групповых занятий нет.</p>
              </div>
            ) : (
              todaySlots.map((slot, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 font-sans"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Класс Группового Танго</p>
                      <p className="text-[10px] text-slate-400">Уровень: Общий</p>
                    </div>
                  </div>
                  <span className="font-sans text-xs bg-slate-800 text-slate-100 font-semibold px-2 py-0.5 rounded">
                    {slot.time}
                  </span>
                </div>
              ))
            )}
            <button
              onClick={() => onNavigate("schedule")}
              className="w-full text-center py-2 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-500 text-[11px] font-sans hover:bg-slate-50 transition-colors uppercase tracking-wider block font-semibold cursor-pointer"
            >
              Настроить Расписание
            </button>
          </div>
        </div>

        <div className="lg:col-span-7 space-y-3">
        {/* Running Out Of credits warning list */}
        <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
              <span className="w-2 h-2 bg-rose-600 rounded-full" />
              Заканчивается абонемент (≤ 2)
            </h2>
            <span className="text-[10px] bg-rose-50 text-rose-700 font-sans px-2 py-0.5 rounded font-semibold tabular-nums">
              {warningSubs.length}
            </span>
          </div>

          <div className="overflow-x-auto">
            {warningSubs.length === 0 ? (
              <div className="text-center py-5 text-slate-400 space-y-1">
                <p className="text-xs">✨ Все абонементы обеспечены достаточным балансом классов.</p>
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                {warningSubs.map((sub, i) => {
                  const c1 = clientMap[sub.clientId1];
                  const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
                  const tgUrl = c1?.telegram ? normalizeTelegramContact(c1.telegram) : null;

                  return (
                    <div
                      key={i}
                      className="p-2 bg-slate-50 rounded-lg border border-slate-100 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-sans font-semibold text-slate-800 text-xs min-w-0 truncate">
                          {c1
                            ? c2
                              ? formatPairName(c1.lastName, c1.firstName, c2.lastName, c2.firstName)
                              : formatClientName(c1.lastName, c1.firstName)
                            : sub.clientId1}
                        </p>
                        {tgUrl && c1 ? (
                          <a
                            href={tgUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              e.preventDefault();
                              openTelegramContact(c1.telegram);
                            }}
                            className="inline-flex items-center justify-center p-1 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md transition-colors shrink-0"
                            title="Написать в Telegram"
                            aria-label="Написать в Telegram"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </a>
                        ) : null}
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[9px] font-sans uppercase bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-semibold shrink-0">
                          {sub.type === "solo" ? "Соло" : "Парный"}
                        </span>
                        <span className="text-[10px] text-slate-400 font-sans shrink-0">
                          активирован {sub.activationDate}
                        </span>
                      </div>

                      <p className="text-[10px] font-sans text-slate-500">
                        Баланс{" "}
                        <span className="font-semibold text-rose-700">{sub.lessonsLeft}</span>
                        <span className="text-slate-400"> из {sub.lessonsTotal}</span>
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Monthly statistics */}
        <div className="bg-white rounded-xl p-3.5 border border-slate-200/90 shadow-xs space-y-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              Статистика за {monthLabel}
            </h2>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-200/70 rounded-lg overflow-hidden border border-slate-200/70">
            <div className="bg-white px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Групповых уроков
              </p>
              <h4 className="text-lg font-semibold text-slate-800 mt-0.5 leading-none">{monthGroupLessons}</h4>
            </div>
            <div className="bg-white px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Продано абонементов
              </p>
              <h4 className="text-lg font-semibold text-indigo-700 mt-0.5 leading-none">{formatCurrency(monthSubsRevenue)}</h4>
            </div>
            <div className="bg-white px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Персональных уроков
              </p>
              <h4 className="text-lg font-semibold text-slate-800 mt-0.5 leading-none">{monthPersonalCount}</h4>
            </div>
            <div className="bg-white px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Оплачено персональных
              </p>
              <h4 className="text-lg font-semibold text-emerald-700 mt-0.5 leading-none">{formatCurrency(monthPersonalPaidSum)}</h4>
            </div>
            <div className="bg-white px-3 py-2.5 col-span-2">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Общий доход за месяц
              </p>
              <h4 className="text-lg font-semibold text-slate-900 mt-0.5 leading-none">{formatCurrency(monthTotalRevenue)}</h4>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
