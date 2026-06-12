/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";
import { Users, Ticket, Calendar, AlertCircle, Send } from "lucide-react";
import { formatClientName, formatCurrency, formatPairName, dowFull, jsDayToIsoDow, pluralizeRu } from "../lib/utils";
import { normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { Client, Subscription, ScheduleSlot, PersonalLesson } from "../types";

interface DashboardProps {
  clients: Client[];
  subscriptions: Subscription[];
  schedule: ScheduleSlot[];
  personalLessons: PersonalLesson[];
  onNavigate: (panel: string) => void;
}

export default function Dashboard({
  clients,
  subscriptions,
  schedule,
  personalLessons,
  onNavigate,
}: DashboardProps) {
  const activeSubs = subscriptions.filter((s) => s.status === "active");
  const solosCount = activeSubs.filter((s) => s.type === "solo").length;
  const pairsCount = activeSubs.filter((s) => s.type === "pair" || s.type === "pair_hm").length;

  // Warning memberships logic (<= 2 credits remaining)
  const warningSubs = activeSubs.filter((s) => s.lessonsLeft <= 2);

  const clientMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {} as Record<string, Client>);

  const pendingRevenue = personalLessons
    .filter((l) => l.paid === "no")
    .reduce((sum, l) => sum + l.price, 0);

  const todayIsoDow = jsDayToIsoDow(new Date().getDay());
  const todaySlots = schedule.filter((s) => s.dayOfWeek === todayIsoDow);

  return (
    <div id="panel-dashboard" className="space-y-6">
      {/* Statistics widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white rounded-xl p-4.5 border border-slate-200/90 shadow-xs flex items-center gap-4 cursor-pointer hover:shadow-sm transition-all"
          onClick={() => onNavigate("activeSubs")}
        >
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
            <Ticket className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Абонементы</p>
            <h3 className="text-xl font-bold text-slate-800 leading-tight">{activeSubs.length}</h3>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5">
              <span className="text-indigo-600 font-semibold">{solosCount}</span> соло ·{" "}
              <span className="text-indigo-600 font-semibold">{pairsCount}</span> парных
            </p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white rounded-xl p-4.5 border border-slate-200/90 shadow-xs flex items-center gap-4 cursor-pointer hover:shadow-sm transition-all"
          onClick={() => onNavigate("newClient")}
        >
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded-lg">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Всего клиентов</p>
            <h3 className="text-xl font-bold text-slate-800 leading-tight">{clients.length}</h3>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5">карточек в реестре</p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white rounded-xl p-4.5 border border-slate-200/90 shadow-xs flex items-center gap-4 cursor-pointer hover:shadow-sm transition-all"
          onClick={() => onNavigate("personalView")}
        >
          <div className="p-2.5 bg-rose-50 text-rose-600 rounded-lg">
            <AlertCircle className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Ожидает оплаты</p>
            <h3 className="text-lg font-mono font-bold text-rose-700 leading-tight">{formatCurrency(pendingRevenue)}</h3>
            <p className="text-[10px] text-rose-600 font-sans mt-0.5 font-medium">из приватных сессий</p>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Today Schedule section */}
        <div className="lg:col-span-5 bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center gap-2 text-slate-800">
              <Calendar className="w-4.5 h-4.5 text-indigo-500" />
              <h2 className="font-sans text-sm font-bold tracking-tight">Сегодняшний день</h2>
            </div>
            <span className="text-[10px] font-mono uppercase bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold">
              {dowFull(todayIsoDow)}
            </span>
          </div>

          <div className="space-y-2 pt-0.5">
            {todaySlots.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-slate-400 text-xs font-sans">Сегодня групповых занятий нет.</p>
              </div>
            ) : (
              todaySlots.map((slot, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2.5 bg-slate-50 rounded-lg border border-slate-100 font-sans"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    <div>
                      <p className="text-xs font-semibold text-slate-800">Класс Группового Танго</p>
                      <p className="text-[10px] text-slate-400">Уровень: Общий</p>
                    </div>
                  </div>
                  <span className="font-mono text-xs bg-slate-800 text-slate-100 font-bold px-2 py-0.5 rounded">
                    {slot.time}
                  </span>
                </div>
              ))
            )}
            <button
              onClick={() => onNavigate("schedule")}
              className="w-full text-center py-2.5 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-500 text-[11px] font-sans hover:bg-slate-50 transition-colors uppercase tracking-wider block font-bold cursor-pointer"
            >
              Настроить Расписание
            </button>
          </div>
        </div>

        {/* Running Out Of credits warning list */}
        <div className="lg:col-span-7 bg-white rounded-xl p-5 border border-slate-200/90 shadow-xs space-y-3.5">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <h2 className="font-sans text-sm font-bold text-slate-800 flex items-center gap-2">
              <span className="w-2 h-2 bg-rose-600 rounded-full" />
              Заканчиваются занятия (≤ 2)
            </h2>
            <span className="text-[10px] bg-rose-50 text-rose-700 font-mono px-2 py-0.5 rounded font-bold">
              {warningSubs.length} {pluralizeRu(warningSubs.length, ["абонемент", "абонемента", "абонементов"])}
            </span>
          </div>

          <div className="overflow-x-auto">
            {warningSubs.length === 0 ? (
              <div className="text-center py-10 text-slate-400 space-y-1">
                <p className="text-xs">✨ Все абонементы обеспечены достаточным балансом классов.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {warningSubs.map((sub, i) => {
                  const c1 = clientMap[sub.clientId1];
                  const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
                  const tgUrl = c1?.telegram ? normalizeTelegramContact(c1.telegram) : null;

                  return (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-slate-50 rounded-lg gap-3 border border-slate-100"
                    >
                      <div className="space-y-0.5">
                        <div className="font-sans font-bold text-slate-800 text-xs">
                          {c1
                            ? c2
                              ? formatPairName(c1.lastName, c1.firstName, c2.lastName, c2.firstName)
                              : formatClientName(c1.lastName, c1.firstName)
                            : sub.clientId1}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-mono uppercase bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-semibold">
                            {sub.type === "solo" ? "Соло" : "Парный"}
                          </span>
                          <span className="text-[10px] text-slate-400 font-sans">
                            активирован {sub.activationDate}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
                        <div className="text-right">
                          <p className="text-[9px] font-mono text-slate-400 uppercase leading-none">баланс</p>
                          <p className="text-sm font-mono font-bold text-rose-700 mt-0.5">
                            {sub.lessonsLeft} <span className="text-[10px] text-slate-400 font-sans">из {sub.lessonsTotal}</span>
                          </p>
                        </div>

                        {tgUrl && c1 ? (
                          <a
                            href={tgUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              e.preventDefault();
                              openTelegramContact(c1.telegram);
                            }}
                            className="inline-flex items-center justify-center p-1.5 bg-[#229ED9]/10 hover:bg-[#229ED9]/20 text-[#1C82B4] rounded-md transition-colors"
                            title="Написать в Telegram"
                            aria-label="Написать в Telegram"
                          >
                            <Send className="w-3.5 h-3.5" />
                          </a>
                        ) : (
                          <span className="text-slate-400 font-mono text-[10px] select-none italic">без TG</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
