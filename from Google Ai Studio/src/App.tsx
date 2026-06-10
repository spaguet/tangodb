/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from "react";
import { useTangoStore } from "./hooks/useTangoStore";
import {
  Sparkles,
  Users,
  Ticket,
  Calendar,
  FileSpreadsheet,
  Coins,
  LayoutDashboard,
  Menu,
  X,
  Send,
  HelpCircle,
} from "lucide-react";

import Dashboard from "./components/Dashboard";
import ClientsPanel from "./components/ClientsPanel";
import SubscriptionsPanel from "./components/SubscriptionsPanel";
import AttendancePanel from "./components/AttendancePanel";
import PersonalLessonsPanel from "./components/PersonalLessonsPanel";
import PricesPanel from "./components/PricesPanel";
import SchedulePanel from "./components/SchedulePanel";
import SyncPanel from "./components/SyncPanel";

export default function App() {
  const store = useTangoStore();
  const [activePanel, setActivePanel] = useState<string>("dashboard");
  const [subPanelTab, setSubPanelTab] = useState<"active" | "sell">("active");
  const [persPanelTab, setPersPanelTab] = useState<"view" | "book">("view");

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3500);
  };

  // Nav routing proxy helper to bridge GAS navigation names smoothly
  const handleNavigate = (panel: string) => {
    setMobileDrawerOpen(false);

    if (panel === "sellSub") {
      setActivePanel("subscriptions");
      setSubPanelTab("sell");
    } else if (panel === "activeSubs") {
      setActivePanel("subscriptions");
      setSubPanelTab("active");
    } else if (panel === "personalSell") {
      setActivePanel("personal");
      setPersPanelTab("book");
    } else if (panel === "personalView") {
      setActivePanel("personal");
      setPersPanelTab("view");
    } else {
      setActivePanel(panel);
    }
  };

  // Human-readable titles mapped to routing ID keys
  const getPanelTitle = () => {
    switch (activePanel) {
      case "dashboard":
        return "Кабинет Администратора";
      case "newClient":
        return "Реестр Танцоров";
      case "subscriptions":
        return subPanelTab === "sell" ? "Оформить Новый Баланс" : "Действующие Пакеты";
      case "schedule":
        return "Расписание Классов";
      case "attendance":
        return "Журнал посещаемости";
      case "personal":
        return persPanelTab === "book" ? "Бронь Приватной Сессии" : "Касса Индивидуальных уроков";
      case "prices":
        return "Регулятор Тарифов";
      case "sync":
        return "Серверная синхронизация G-Sheets";
      default:
        return "TangoDB";
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 text-slate-800 antialiased font-sans transition-all">
      {/* --- DESKTOP LEFT SIDEBAR --- */}
      <aside className="hidden md:flex flex-col w-64 bg-white text-slate-700 border-r border-slate-200 p-0 flex-shrink-0 relative z-30 shadow-xs">
        {/* Minimal High-Density Branding header */}
        <div
          onClick={() => handleNavigate("dashboard")}
          className="relative px-5 py-4.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors flex items-center gap-3.5"
        >
          <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-mono font-bold text-sm shadow-xs">
            T
          </div>
          <div>
            <h1 className="font-sans text-base font-bold tracking-tight text-slate-800 leading-tight">
              TangoDB <span className="text-indigo-600 font-medium">Panel</span>
            </h1>
            <p className="text-[9px] font-mono tracking-widest text-slate-400 uppercase mt-0.5">
              STUDIO CONTROLLER
            </p>
          </div>
        </div>

        {/* Dense Sidebar Navigations */}
        <nav className="relative flex-1 overflow-y-auto px-3 py-4 space-y-4">
          <div className="space-y-0.5">
            <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">
              Аналитика
            </p>
            <button
              onClick={() => handleNavigate("dashboard")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "dashboard"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              Обзор
            </button>
          </div>

          <div className="space-y-0.5">
            <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">
              Гости & Баланс
            </p>
            <button
              onClick={() => handleNavigate("newClient")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "newClient"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              Все Танцоры
            </button>
            <button
              onClick={() => handleNavigate("activeSubs")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "subscriptions" && subPanelTab === "active"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <Ticket className="w-3.5 h-3.5" />
              Абонементы (Баланс)
            </button>
            <button
              onClick={() => handleNavigate("sellSub")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "subscriptions" && subPanelTab === "sell"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <Ticket className="w-3.5 h-3.5 opacity-50" />
              Оформить билет
            </button>
          </div>

          <div className="space-y-0.5">
            <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">
              Занятия & Журналы
            </p>
            <button
              onClick={() => handleNavigate("schedule")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "schedule"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Расписание уроков
            </button>
            <button
              onClick={() => handleNavigate("attendance")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "attendance"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <Calendar className="w-3.5 h-3.5 opacity-60" />
              Отметить класс
            </button>
          </div>

          <div className="space-y-0.5">
            <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">
              Личные занятия
            </p>
            <button
              onClick={() => handleNavigate("personalView")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "personal"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              Персональные
            </button>
          </div>

          <div className="space-y-0.5">
            <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">
              Настройки & База
            </p>
            <button
              onClick={() => handleNavigate("prices")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "prices"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <Coins className="w-3.5 h-3.5" />
              Прайс-лист
            </button>
            <button
              onClick={() => handleNavigate("sync")}
              className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                activePanel === "sync"
                  ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Синхронизация
            </button>
          </div>
        </nav>

        {/* Bottom copyright display */}
        <div className="p-4 border-t border-slate-100 text-center text-[10px] text-slate-400 font-mono">
          © TangoDB Sheet Controller
        </div>
      </aside>

      {/* --- MOBILE FIXED FLOATING NAV-BAR --- */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 text-slate-500 z-40 flex justify-around items-center px-4 shadow-md">
        <button
          onClick={() => handleNavigate("dashboard")}
          className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${
            activePanel === "dashboard" ? "text-indigo-600 font-bold scale-102" : "text-slate-400"
          }`}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[9px] font-mono uppercase tracking-wider font-semibold">Обзор</span>
        </button>

        <button
          onClick={() => handleNavigate("activeSubs")}
          className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${
            activePanel === "subscriptions" ? "text-indigo-600 font-bold scale-102" : "text-slate-400"
          }`}
        >
          <Ticket className="w-5 h-5" />
          <span className="text-[9px] font-mono uppercase tracking-wider font-semibold">Билеты</span>
        </button>

        <button
          onClick={() => handleNavigate("attendance")}
          className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${
            activePanel === "attendance" ? "text-indigo-600 font-bold scale-102" : "text-slate-400"
          }`}
        >
          <Calendar className="w-5 h-5" />
          <span className="text-[9px] font-mono uppercase tracking-wider font-semibold">Журнал</span>
        </button>

        <button
          onClick={() => handleNavigate("personalView")}
          className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${
            activePanel === "personal" ? "text-indigo-600 font-bold scale-102" : "text-slate-400"
          }`}
        >
          <Sparkles className="w-5 h-5" />
          <span className="text-[9px] font-mono uppercase tracking-wider font-semibold">Приваты</span>
        </button>

        <button
          onClick={() => setMobileDrawerOpen(true)}
          className="flex flex-col items-center gap-1 text-slate-400 cursor-pointer hover:text-slate-600"
        >
          <Menu className="w-5 h-5" />
          <span className="text-[9px] font-mono uppercase tracking-wider font-semibold">Меню</span>
        </button>
      </div>

      {/* --- MAIN OPERATIONAL AREA --- */}
      <main className="flex-1 flex flex-col min-h-screen pb-16 md:pb-0 font-sans">
        {/* TOP CONTROLLER HEADER BAR */}
        <header className="sticky top-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between z-20 shadow-xs">
          <div className="flex items-center gap-3">
            {/* Mobile Drawer Trigger Menu */}
            <button
              onClick={() => setMobileDrawerOpen(true)}
              className="md:hidden p-1.5 text-slate-650 hover:text-slate-900 hover:bg-slate-55 rounded-lg cursor-pointer transition-all"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h2 className="font-sans text-base font-bold text-slate-800 tracking-tight leading-tight">
              {getPanelTitle()}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Slate/Indigo responsive connectivity status badges */}
            {store.isSandboxMode ? (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 text-xs rounded-full border border-amber-200/50 font-semibold shadow-xs select-none hover:bg-amber-100/60 transition-colors">
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                <span>Sandbox Mode (Local)</span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 text-xs rounded-full border border-green-150 font-semibold shadow-xs select-none hover:bg-green-100/60 transition-colors">
                <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                <span>Connected to Google Sheets</span>
              </div>
            )}

            {/* High-density Primary Synchronize button */}
            <button
              onClick={async () => {
                await store.refreshData();
                showToast("🔄 База данных Sheets успешно синхронизирована");
              }}
              className="hidden sm:block text-xs font-sans font-semibold bg-indigo-600 hover:bg-indigo-700 text-white px-3.5 py-1.5 rounded transition-all shadow-xs cursor-pointer"
            >
              Sync Now
            </button>
          </div>
        </header>

        {/* SCROLLABLE INNER PAGE CONTENT WINDOW */}
        <section className="flex-1 p-6 md:p-8 xl:p-10 max-w-7xl w-full mx-auto space-y-8 overflow-y-auto">
          {store.loading ? (
            <div className="flex flex-col items-center justify-center py-40 text-stone-400 gap-3.5">
              <div className="w-8 h-8 rounded-full border-4 border-gold-200 border-t-gold-600 animate-spin" />
              <p className="text-xs font-mono font-bold tracking-widest uppercase">Загрузка базы из Google Sheets...</p>
            </div>
          ) : (
            <>
              {activePanel === "dashboard" && (
                <Dashboard
                  clients={store.clients}
                  subscriptions={store.subscriptions}
                  schedule={store.schedule}
                  personalLessons={store.personalLessons}
                  onNavigate={handleNavigate}
                />
              )}

              {activePanel === "newClient" && (
                <ClientsPanel
                  clients={store.clients}
                  onAddClient={store.addClient}
                  onUpdateClient={store.updateClient}
                  onDeleteClient={store.deleteClient}
                  toast={showToast}
                />
              )}

              {activePanel === "subscriptions" && (
                <SubscriptionsPanel
                  clients={store.clients}
                  subscriptions={store.subscriptions}
                  prices={store.prices}
                  onAddSubscription={store.addSubscription}
                  onFinishSubscription={store.finishSubscription}
                  toast={showToast}
                />
              )}

              {activePanel === "schedule" && (
                <SchedulePanel
                  schedule={store.schedule}
                  onAddScheduleSlot={store.addScheduleSlot}
                  onDeleteScheduleSlot={store.deleteScheduleSlot}
                  toast={showToast}
                />
              )}

              {activePanel === "attendance" && (
                <AttendancePanel
                  getScheduleDatesForMonth={store.getScheduleDatesForMonth}
                  getSubsForDate={store.getSubsForDate}
                  onMarkAttendance={store.markAttendance}
                  toast={showToast}
                />
              )}

              {activePanel === "personal" && (
                <PersonalLessonsPanel
                  clients={store.clients}
                  personalLessons={store.personalLessons}
                  prices={store.prices}
                  onAddPersonalLessons={store.addPersonalLessons}
                  onUpdatePersonalPaid={store.updatePersonalLessonPaid}
                  onDeletePersonal={store.deletePersonalLessonRow}
                  toast={showToast}
                />
              )}

              {activePanel === "prices" && (
                <PricesPanel
                  prices={store.prices}
                  onUpdatePrice={store.updatePrice}
                  toast={showToast}
                />
              )}

              {activePanel === "sync" && <SyncPanel toast={showToast} />}
            </>
          )}
        </section>
      </main>

      {/* --- SLIDEOUT MOBILE DRAWER PANEL --- */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden flex-row-reverse">
          <div
            onClick={() => setMobileDrawerOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
          />

          <div className="relative flex flex-col w-72 max-w-xs bg-white text-slate-700 p-0 h-full border-l border-slate-200 shadow-xl">
            <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 bg-indigo-600 rounded flex items-center justify-center text-white font-mono font-bold text-xs shadow-xs">
                  T
                </div>
                <div>
                  <h3 className="font-sans text-sm font-bold tracking-tight text-slate-800">
                    TangoDB Panel
                  </h3>
                  <p className="text-[8px] font-mono uppercase tracking-widest text-slate-400 mt-0.5">
                    Studio Portal
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg bg-slate-50 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <button
                onClick={() => handleNavigate("dashboard")}
                className="w-full text-left py-1.5 text-xs font-bold uppercase tracking-wide flex items-center gap-2 text-slate-800 border-b border-slate-100/60 pb-2"
              >
                📊 Общий обзор
              </button>

              <div className="space-y-1.5 pt-1">
                <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold">Ученики</p>
                <button
                  onClick={() => handleNavigate("newClient")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  👤 База Гостей Студии
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold">Проездные</p>
                <button
                  onClick={() => handleNavigate("activeSubs")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  📋 Действующие Пакеты
                </button>
                <button
                  onClick={() => handleNavigate("sellSub")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  ＋ Оформить новый билет
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold">Сетка Занятий</p>
                <button
                  onClick={() => handleNavigate("schedule")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  🗓 Редактор Расписания
                </button>
                <button
                  onClick={() => handleNavigate("attendance")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  ✅ Отметки Посещений (Журнал)
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold">Индивидуальные</p>
                <button
                  onClick={() => handleNavigate("personalView")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  👁 Просмотр приватников
                </button>
                <button
                  onClick={() => handleNavigate("personalSell")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  ⭐ Бронь Личного Урока
                </button>
              </div>

              <div className="space-y-1.5">
                <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold">Цена и настройки</p>
                <button
                  onClick={() => handleNavigate("prices")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  💰 Цены и тарифная сетка
                </button>
                <button
                  onClick={() => handleNavigate("sync")}
                  className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600 flex items-center gap-2"
                >
                  ☁️ Координация с G-Sheets
                </button>
              </div>
            </nav>
          </div>
        </div>
      )}

      {/* --- TOAST METRIC NOTIFICATION DRAWER --- */}
      {toastMessage && (
        <div className="fixed bottom-20 md:bottom-8 right-6 left-6 md:left-auto max-w-sm md:w-80 bg-slate-900 border border-indigo-500/35 text-slate-100 text-xs font-sans font-medium rounded-lg px-4.5 py-3 shadow-xl z-50 flex items-center justify-between gap-3 animate-fade-in">
          <span>{toastMessage}</span>
          <button
            onClick={() => setToastMessage(null)}
            className="p-1 text-slate-400 hover:text-white rounded-full bg-white/5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
