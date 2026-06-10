/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { motion } from "motion/react";
import { Users, Ticket, Calendar, DollarSign, AlertCircle, Play } from "lucide-react";
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

  // Financial calculations
  const totalPaidRevenue = personalLessons
    .filter((l) => l.paid === "yes")
    .reduce((sum, l) => sum + l.price, 0);

  const pendingRevenue = personalLessons
    .filter((l) => l.paid === "no")
    .reduce((sum, l) => sum + l.price, 0);

  // Formatting currency (VND ₫)
  const formatCur = (num: number) => {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "VND", maximumFractionDigits: 0 })
      .format(num)
      .replace("VND", "₫");
  };

  // Map day numbers of JS to day of the week
  const getDayName = (dayNum: number) => {
    const names = ["Воскресенье", "Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
    return names[dayNum];
  };

  const getDayOfWeekNumber = () => {
    const day = new Date().getDay();
    return day === 0 ? 7 : day;
  };

  const todaySlots = schedule.filter((s) => s.dayOfWeek === getDayOfWeekNumber());

  return (
    <div id="panel-dashboard" className="space-y-6">
      {/* Hero Welcome banner holding the mood */}
      <div className="relative overflow-hidden bg-slate-900 text-white rounded-xl p-6 md:p-8 shadow-xs border border-slate-800">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom_right,rgba(79,70,229,0.15),transparent_60%)] pointer-events-none" />
        <div className="max-w-2xl space-y-2">
          <span className="font-mono text-xs text-indigo-400 tracking-wider uppercase block font-semibold">
            Argentine Tango & Milonga Studio
          </span>
          <h1 className="font-sans text-2xl md:text-3xl font-bold tracking-tight leading-none text-white">
            La Seducción del Tango
          </h1>
          <p className="text-slate-300 font-sans text-xs md:text-sm leading-relaxed">
            Добро пожаловать в панель управления TangoDB. Управляйте расписанием занятий, отмечайте посещения, контролируйте пакеты абонементов клиентов и распределяйте личные репетиции с безупречной элегантностью.
          </p>
        </div>
      </div>

      {/* Statistics widgets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
            <p className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Всего гостей</p>
            <h3 className="text-xl font-bold text-slate-800 leading-tight">{clients.length}</h3>
            <p className="text-[10px] text-slate-500 font-sans mt-0.5">карточек в реестре</p>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -2 }}
          className="bg-white rounded-xl p-4.5 border border-slate-200/90 shadow-xs flex items-center gap-4 cursor-pointer hover:shadow-sm transition-all"
          onClick={() => onNavigate("personalView")}
        >
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-lg">
            <DollarSign className="w-5 h-5" />
          </div>
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-mono tracking-wider font-bold">Касса персональных</p>
            <h3 className="text-lg font-mono font-bold text-slate-800 leading-tight">{formatCur(totalPaidRevenue)}</h3>
            <p className="text-[10px] text-emerald-650 font-sans mt-0.5 font-medium">оплаченные уроки</p>
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
            <h3 className="text-lg font-mono font-bold text-rose-700 leading-tight">{formatCur(pendingRevenue)}</h3>
            <p className="text-[10px] text-rose-650 font-sans mt-0.5 font-medium">из приватных сессий</p>
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
              {getDayName(new Date().getDay())}
            </span>
          </div>

          <div className="space-y-2 pt-0.5">
            {todaySlots.length === 0 ? (
              <div className="text-center py-8 space-y-1">
                <p className="text-slate-300 font-sans text-2xl">☕</p>
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
              className="w-full text-center py-2.5 border border-dashed border-slate-250 hover:border-slate-400 rounded-lg text-slate-500 text-[11px] font-sans hover:bg-slate-50 transition-colors uppercase tracking-wider block font-bold cursor-pointer"
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
              {warningSubs.length} гость
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
                  const clientMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {} as Record<string, Client>);
                  const c1 = clientMap[sub.clientId1];
                  const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;

                  return (
                    <div
                      key={i}
                      className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-3 bg-slate-50 rounded-lg gap-3 border border-slate-100"
                    >
                      <div className="space-y-0.5">
                        <div className="font-sans font-bold text-slate-800 text-xs">
                          {c1 ? `${c1.lastName} ${c1.firstName}` : sub.clientId1}
                          {c2 ? ` & ${c2.lastName} ${c2.firstName}` : ""}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[9px] font-mono uppercase bg-slate-200 text-slate-705 px-1.5 py-0.5 rounded font-semibold">
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

                        {/* Direct contact link to Telegram */}
                        {c1?.telegram ? (
                          <a
                            href={c1.telegram}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-[#229ED9] hover:bg-[#1C82B4] text-white px-2.5 py-1 rounded font-mono text-[10px] font-bold transition-all shadow-xs flex items-center gap-1"
                          >
                            TG
                          </a>
                        ) : (
                          <span className="text-slate-350 font-mono text-[10px] select-none italic">без TG</span>
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
