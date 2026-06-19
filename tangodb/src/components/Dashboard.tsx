import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { Users, Ticket, Calendar, AlertCircle, Send, BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import {
  formatClientName,
  formatCurrency,
  dowFull,
  jsDayToIsoDow,
  currentYearMonth,
  formatMonthTitleRu,
  isDateInYearMonth,
  getSubscriptionPrice,
} from "../lib/utils";
import { normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { computeScheduleDatesForMonth } from "../hooks/useAttendance";
import type { ToastType } from "../App";
import { Client, Subscription, ScheduleSlot, PersonalLesson, Price } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";

interface DashboardProps {
  clients: Client[];
  subscriptions: Subscription[];
  schedule: ScheduleSlot[];
  personalLessons: PersonalLesson[];
  prices: Price[];
  toast: (msg: string, type?: ToastType) => void;
  onNavigate: (panel: string) => void;
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function todayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

type TodayScheduleEntry =
  | { kind: "group"; start: string; slot: ScheduleSlot; key: string }
  | { kind: "personal"; start: string; lesson: PersonalLesson; key: string };

function personalTypeLabel(type: string): string {
  if (type === "solo") return "Соло";
  if (type === "trio") return "Трио";
  return "Парный";
}

export default function Dashboard({
  clients,
  subscriptions,
  schedule,
  personalLessons,
  prices,
  toast,
  onNavigate,
}: DashboardProps) {
  const { settings } = useOrganization();
  const lowBalanceThreshold = settings?.low_balance_threshold ?? 2;
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const isViewingCurrentMonth = statsMonth === currentYearMonth();

  const activeSubs = subscriptions.filter((s) => s.status === "active");
  const solosCount = activeSubs.filter((s) => s.type === "solo").length;
  const pairsCount = activeSubs.filter((s) => s.type === "pair" || s.type === "pair_hm").length;

  const warningSubs = activeSubs.filter((s) => s.lessonsLeft <= lowBalanceThreshold);

  const clientMap = useMemo(
    () => Object.fromEntries(clients.map((c) => [c.id, c])) as Record<string, Client>,
    [clients]
  );

  const unpaidLessons = personalLessons.filter((l) => l.paid === "no");
  const pendingUnpaidCount = unpaidLessons.length;
  const pendingRevenue = unpaidLessons.reduce((sum, l) => sum + l.price, 0);
  const hasPendingPayment = pendingUnpaidCount > 0 && pendingRevenue > 0;
  const pendingPaymentColor = hasPendingPayment ? "text-rose-600" : "text-slate-400";

  const todayIsoDow = jsDayToIsoDow(new Date().getDay());
  const todayDate = todayDateStr();
  const todaySlots = schedule.filter((s) => s.dayOfWeek === todayIsoDow);
  const openAttendanceJournal = () => onNavigate("attendance");

  const todayScheduleEntries = useMemo((): TodayScheduleEntry[] => {
    const entries: TodayScheduleEntry[] = [
      ...todaySlots.map((slot, index) => ({
        kind: "group" as const,
        start: slot.time,
        slot,
        key: `g-${index}-${slot.time}`,
      })),
      ...personalLessons
        .filter((l) => l.date === todayDate)
        .map((lesson) => ({
          kind: "personal" as const,
          start: lesson.timeStart,
          lesson,
          key: `p-${lesson.id}`,
        })),
    ];
    return entries.sort((a, b) => a.start.localeCompare(b.start));
  }, [todaySlots, personalLessons, todayDate]);

  const monthStats = useMemo(() => {
    const monthGroupLessons = computeScheduleDatesForMonth(schedule, statsMonth).length;
    const monthSoldSubs = subscriptions.filter((s) => isDateInYearMonth(s.activationDate, statsMonth));
    const monthSubsRevenue = monthSoldSubs.reduce((sum, s) => sum + getSubscriptionPrice(s, prices), 0);
    const monthPersonalLessons = personalLessons.filter((l) => isDateInYearMonth(l.date, statsMonth));
    const monthPersonalCount = monthPersonalLessons.length;
    const monthPersonalPaidSum = monthPersonalLessons
      .filter((l) => l.paid === "yes")
      .reduce((sum, l) => sum + l.price, 0);
    const monthTotalRevenue = monthSubsRevenue + monthPersonalPaidSum;
    return {
      monthGroupLessons,
      monthSubsRevenue,
      monthPersonalCount,
      monthPersonalPaidSum,
      monthTotalRevenue,
    };
  }, [schedule, statsMonth, subscriptions, personalLessons, prices]);

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
              <Ticket className="text-indigo-600 shrink-0 w-5 h-5" />
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
              <Users className="text-indigo-600 shrink-0 w-5 h-5" />
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
            <AlertCircle className="shrink-0 w-5 h-5" />
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
            {todayScheduleEntries.length === 0 ? (
              <div className="text-center py-4">
                <p className="text-slate-400 text-xs font-sans">Сегодня занятий нет.</p>
              </div>
            ) : (
              todayScheduleEntries.map((entry) => {
                if (entry.kind === "group") {
                  const { slot } = entry;
                  const disciplineName = "Групповое занятие";

                  return (
                    <div
                      key={entry.key}
                      className="flex items-center justify-between p-2 bg-slate-50 rounded-lg border border-slate-100 font-sans cursor-pointer hover:bg-slate-100/80 transition-colors"
                      onClick={openAttendanceJournal}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") openAttendanceJournal();
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-pulse shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">{disciplineName}</p>
                          <p className="text-[10px] text-slate-400">
                            {slot.time} – {slot.timeEnd || "21:00"}
                          </p>
                        </div>
                      </div>
                      <span className="font-sans text-xs bg-slate-800 text-slate-100 font-semibold px-2 py-0.5 rounded shrink-0">
                        {slot.time}
                      </span>
                    </div>
                  );
                }

                const { lesson } = entry;
                return (
                  <div
                    key={entry.key}
                    className="flex items-center justify-between p-2 bg-indigo-50/60 rounded-lg border border-indigo-100 font-sans cursor-pointer hover:bg-indigo-50 transition-colors"
                    onClick={openAttendanceJournal}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") openAttendanceJournal();
                    }}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-1.5 h-1.5 bg-indigo-700 rounded-full shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-800 truncate">{lesson.clientDisplay}</p>
                        <p className="text-[10px] text-slate-400">
                          Персональный · {personalTypeLabel(lesson.type)}
                          {lesson.paid === "no" ? " · не оплачен" : ""}
                        </p>
                      </div>
                    </div>
                    <span className="font-sans text-xs bg-indigo-700 text-indigo-50 font-semibold px-2 py-0.5 rounded shrink-0">
                      {lesson.timeStart}
                    </span>
                  </div>
                );
              })
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
              Заканчивается абонемент (≤ {lowBalanceThreshold})
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
                  const c3 = sub.clientId3 ? clientMap[sub.clientId3] : null;
                  const clientLabel = c1
                    ? [c1, c2, c3]
                        .filter(Boolean)
                        .map((c) => formatClientName(c!.lastName, c!.firstName))
                        .join(" & ")
                    : sub.clientId1;

                  return (
                    <div
                      key={i}
                      className="p-2 bg-slate-50 rounded-lg border border-slate-100 space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-sans font-semibold text-slate-800 text-xs min-w-0 truncate">
                          {clientLabel}
                        </p>
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
                                title={`Написать ${c.firstName} в Telegram`}
                                aria-label={`Написать ${c.firstName} в Telegram`}
                              >
                                <Send className="w-3.5 h-3.5" />
                              </a>
                            );
                          })}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-sans uppercase bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded font-semibold shrink-0">
                          {sub.type === "solo" ? "Соло" : sub.type === "trio" ? "Трио" : "Парный"}
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
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <h2 className="font-sans text-sm font-semibold text-slate-800 flex items-center gap-2 shrink-0">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              Статистика
            </h2>
            <div className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                onClick={() => setStatsMonth((m) => shiftMonth(m, -1))}
                className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer shrink-0"
                aria-label="Предыдущий месяц"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col items-center min-w-0">
                <span className="text-xs font-semibold text-slate-800 truncate">{formatMonthTitleRu(statsMonth)}</span>
                {!isViewingCurrentMonth && (
                  <button
                    type="button"
                    onClick={() => setStatsMonth(currentYearMonth())}
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    Текущий месяц
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setStatsMonth((m) => shiftMonth(m, 1))}
                className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer shrink-0"
                aria-label="Следующий месяц"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px bg-slate-200/70 rounded-lg overflow-hidden border border-slate-200/70">
            <div className="bg-white px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Групповых уроков
              </p>
              <h4 className="text-lg font-semibold text-slate-800 mt-0.5 leading-none">{monthStats.monthGroupLessons}</h4>
            </div>
            <div className="bg-white px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Продано абонементов
              </p>
              <h4 className="text-lg font-semibold text-indigo-700 mt-0.5 leading-none">{formatCurrency(monthStats.monthSubsRevenue)}</h4>
            </div>
            <div className="bg-white px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Персональных уроков
              </p>
              <h4 className="text-lg font-semibold text-slate-800 mt-0.5 leading-none">{monthStats.monthPersonalCount}</h4>
            </div>
            <div className="bg-white px-3 py-2.5">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Оплачено персональных
              </p>
              <h4 className="text-lg font-semibold text-indigo-700 mt-0.5 leading-none">{formatCurrency(monthStats.monthPersonalPaidSum)}</h4>
            </div>
            <div className="bg-white px-3 py-2.5 col-span-2">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                Общий доход за месяц
              </p>
              <h4 className="text-lg font-semibold text-slate-900 mt-0.5 leading-none">{formatCurrency(monthStats.monthTotalRevenue)}</h4>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
