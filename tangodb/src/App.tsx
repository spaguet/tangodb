import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Sparkles,
  Users,
  Ticket,
  Calendar,
  Coins,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
} from "lucide-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import LoginPage from "./auth/LoginPage";
import { useUIStore } from "./store/ui";
import DashboardPage from "./pages/DashboardPage";
import ClientsPage from "./pages/ClientsPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import SchedulePage from "./pages/SchedulePage";
import AttendancePage from "./pages/AttendancePage";
import PersonalPage from "./pages/PersonalPage";
import PricesPage from "./pages/PricesPage";

const ToastContext = createContext<(msg: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

function getPanelTitle(pathname: string, subscriptionsTab: string, personalTab: string): string {
  if (pathname === "/") return "TangoDB";
  if (pathname === "/clients") return "Клиенты";
  if (pathname.startsWith("/subscriptions")) {
    return subscriptionsTab === "sell" ? "Продажа абонемента" : "Действующие абонементы";
  }
  if (pathname === "/schedule") return "Расписание";
  if (pathname === "/attendance") return "Журнал Посещений";
  if (pathname.startsWith("/personal")) {
    return personalTab === "book" ? "Продажа персонального урока" : "Персональные уроки";
  }
  if (pathname === "/prices") return "Регулятор Тарифов";
  return "TangoDB";
}

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const subscriptionsTab = useUIStore((s) => s.subscriptionsTab);
  const personalTab = useUIStore((s) => s.personalTab);
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  }, []);

  const go = (path: string, subTab?: "active" | "sell", persTab?: "view" | "book") => {
    setMobileDrawerOpen(false);
    if (subTab) setSubscriptionsTab(subTab);
    if (persTab) setPersonalTab(persTab);
    navigate(path);
  };

  const isActive = (path: string, tab?: "active" | "sell" | "view" | "book") => {
    if (path === "/") return location.pathname === "/";
    if (path === "/subscriptions") {
      return location.pathname.startsWith("/subscriptions") && (tab ? subscriptionsTab === tab : true);
    }
    if (path === "/personal") {
      return location.pathname.startsWith("/personal") && (tab ? personalTab === tab : true);
    }
    return location.pathname === path;
  };

  const navBtn = (active: boolean) =>
    active
      ? "bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-600 pl-2.5"
      : "text-slate-600 hover:bg-slate-50 hover:text-slate-950";

  return (
    <ToastContext.Provider value={showToast}>
      <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 text-slate-800 antialiased font-sans">
        <aside className="hidden md:flex flex-col w-64 bg-white text-slate-700 border-r border-slate-200 flex-shrink-0 relative z-30 shadow-xs">
          <div
            onClick={() => go("/")}
            className="relative px-5 py-4.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors flex items-center gap-3.5"
          >
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-mono font-bold text-sm shadow-xs">
              T
            </div>
            <div>
              <h1 className="font-sans text-base font-bold tracking-tight text-slate-800 leading-tight">
                TangoDB
              </h1>
              <p className="text-[9px] font-mono tracking-widest text-slate-400 uppercase mt-0.5">STUDIO CONTROLLER</p>
            </div>
          </div>

          <nav className="relative flex-1 overflow-y-auto px-3 py-4 space-y-4">
            <div className="space-y-0.5">
              <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">Аналитика</p>
              <button onClick={() => go("/")} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${navBtn(isActive("/"))}`}>
                <LayoutDashboard className="w-3.5 h-3.5" /> Обзор
              </button>
            </div>

            <div className="space-y-0.5">
              <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">Гости & Баланс</p>
              <button onClick={() => go("/clients")} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${navBtn(isActive("/clients"))}`}>
                <Users className="w-3.5 h-3.5" /> Все Танцоры
              </button>
              <button onClick={() => go("/subscriptions", "active")} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${navBtn(isActive("/subscriptions", "active"))}`}>
                <Ticket className="w-3.5 h-3.5" /> Абонементы (Баланс)
              </button>
              <button onClick={() => go("/subscriptions/sell", "sell")} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${navBtn(isActive("/subscriptions", "sell"))}`}>
                <Ticket className="w-3.5 h-3.5 opacity-50" /> Оформить билет
              </button>
            </div>

            <div className="space-y-0.5">
              <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">Занятия & Журналы</p>
              <button onClick={() => go("/schedule")} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${navBtn(isActive("/schedule"))}`}>
                <Calendar className="w-3.5 h-3.5" /> Расписание уроков
              </button>
              <button onClick={() => go("/attendance")} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${navBtn(isActive("/attendance"))}`}>
                <Calendar className="w-3.5 h-3.5 opacity-60" /> Отметить класс
              </button>
            </div>

            <div className="space-y-0.5">
              <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">Личные занятия</p>
              <button onClick={() => go("/personal", undefined, "view")} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${navBtn(isActive("/personal", "view"))}`}>
                <Sparkles className="w-3.5 h-3.5 text-indigo-600" /> Персональные
              </button>
            </div>

            <div className="space-y-0.5">
              <p className="text-[9px] text-slate-400 font-mono tracking-wider uppercase font-bold px-3 mb-1">Настройки & База</p>
              <button onClick={() => go("/prices")} className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${navBtn(isActive("/prices"))}`}>
                <Coins className="w-3.5 h-3.5" /> Прайс-лист
              </button>
            </div>
          </nav>

          <div className="p-4 border-t border-slate-100 text-center text-[10px] text-slate-400 font-mono">
            © TangoDB Studio Controller
          </div>
        </aside>

        <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 text-slate-500 z-40 flex justify-around items-center px-4 shadow-md">
          <button onClick={() => go("/")} className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${isActive("/") ? "text-indigo-600 font-bold" : "text-slate-400"}`}>
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[9px] font-mono uppercase tracking-wider font-semibold">Обзор</span>
          </button>
          <button onClick={() => go("/subscriptions", "active")} className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${isActive("/subscriptions") ? "text-indigo-600 font-bold" : "text-slate-400"}`}>
            <Ticket className="w-5 h-5" />
            <span className="text-[9px] font-mono uppercase tracking-wider font-semibold">Абонементы</span>
          </button>
          <button onClick={() => go("/attendance")} className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${isActive("/attendance") ? "text-indigo-600 font-bold" : "text-slate-400"}`}>
            <Calendar className="w-5 h-5" />
            <span className="text-[9px] font-mono uppercase tracking-wider font-semibold">Журнал</span>
          </button>
          <button onClick={() => go("/personal", undefined, "view")} className={`flex flex-col items-center gap-1 cursor-pointer transition-colors ${isActive("/personal") ? "text-indigo-600 font-bold" : "text-slate-400"}`}>
            <Sparkles className="w-5 h-5" />
            <span className="text-[8px] font-mono uppercase tracking-wider font-semibold text-center leading-tight max-w-[4.5rem]">Персональные уроки</span>
          </button>
        </div>

        <main className="flex-1 flex flex-col min-h-screen pb-16 md:pb-0 font-sans">
          <header className="sticky top-0 bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between z-20 shadow-xs">
            <div className="flex items-center gap-3">
              <button onClick={() => setMobileDrawerOpen(true)} className="md:hidden p-1.5 text-slate-650 hover:text-slate-900 hover:bg-slate-55 rounded-lg cursor-pointer transition-all">
                <Menu className="w-5 h-5" />
              </button>
              <h2 className="font-sans text-base font-bold text-slate-800 tracking-tight leading-tight">
                {getPanelTitle(location.pathname, subscriptionsTab, personalTab)}
              </h2>
            </div>
            <button
              onClick={() => signOut()}
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded border border-slate-200 hover:bg-slate-50 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Выйти
            </button>
          </header>

          <section className="flex-1 p-6 md:p-8 xl:p-10 max-w-7xl w-full mx-auto space-y-8 overflow-y-auto">
            <Outlet />
          </section>
        </main>

        {mobileDrawerOpen && (
          <div className="fixed inset-0 z-50 flex md:hidden flex-row-reverse">
            <div onClick={() => setMobileDrawerOpen(false)} className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity" />
            <div className="relative flex flex-col w-72 max-w-xs bg-white text-slate-700 p-0 h-full border-l border-slate-200 shadow-xl">
              <div className="flex justify-between items-center px-6 py-4 border-b border-slate-100">
                <h3 className="font-sans text-sm font-bold tracking-tight text-slate-800">TangoDB</h3>
                <button onClick={() => setMobileDrawerOpen(false)} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg bg-slate-50 cursor-pointer">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                <button onClick={() => go("/")} className="w-full text-left py-1.5 text-xs font-bold uppercase tracking-wide text-slate-800 border-b border-slate-100/60 pb-2">📊 Меню</button>
                <button onClick={() => go("/clients")} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600">👤 Клиенты</button>
                <button onClick={() => go("/subscriptions", "active")} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600">📋 Действующие абонементы</button>
                <button onClick={() => go("/subscriptions/sell", "sell")} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600">＋ Продажа абонемента</button>
                <button onClick={() => go("/schedule")} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600">🗓 Расписание</button>
                <button onClick={() => go("/attendance")} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600">✅ Журнал Посещений</button>
                <button onClick={() => go("/personal", undefined, "view")} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600">👁 Персональные уроки</button>
                <button onClick={() => go("/personal/book", undefined, "book")} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600">⭐ Продажа персонального урока</button>
                <button onClick={() => go("/prices")} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-slate-600 hover:text-indigo-600">💰 Цены и тарифная сетка</button>
                <button onClick={() => signOut()} className="w-full text-left pl-2.5 py-1 text-xs uppercase tracking-wide font-semibold text-red-600 hover:text-red-700 mt-4">Выйти</button>
              </nav>
            </div>
          </div>
        )}

        {toastMessage && (
          <div className="fixed bottom-20 md:bottom-8 right-6 left-6 md:left-auto max-w-sm md:w-80 bg-slate-900 border border-indigo-500/35 text-slate-100 text-xs font-sans font-medium rounded-lg px-4.5 py-3 shadow-xl z-50 flex items-center justify-between gap-3">
            <span>{toastMessage}</span>
            <button onClick={() => setToastMessage(null)} className="p-1 text-slate-400 hover:text-white rounded-full bg-white/5 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

function RouteSync() {
  const location = useLocation();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  useEffect(() => {
    if (location.pathname === "/subscriptions/sell") setSubscriptionsTab("sell");
    else if (location.pathname === "/subscriptions") setSubscriptionsTab("active");
    if (location.pathname === "/personal/book") setPersonalTab("book");
    else if (location.pathname === "/personal") setPersonalTab("view");
  }, [location.pathname, setSubscriptionsTab, setPersonalTab]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <ProtectedRoute>
                  <RouteSync />
                  <Outlet />
                </ProtectedRoute>
              }
            >
              <Route element={<AppLayout />}>
                <Route index element={<DashboardPage />} />
                <Route path="clients" element={<ClientsPage />} />
                <Route path="subscriptions" element={<SubscriptionsPage initialTab="active" />} />
                <Route path="subscriptions/sell" element={<SubscriptionsPage initialTab="sell" />} />
                <Route path="schedule" element={<SchedulePage />} />
                <Route path="attendance" element={<AttendancePage />} />
                <Route path="personal" element={<PersonalPage initialTab="view" />} />
                <Route path="personal/book" element={<PersonalPage initialTab="book" />} />
                <Route path="prices" element={<PricesPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
