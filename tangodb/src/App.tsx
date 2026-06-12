import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Sparkles,
  Users,
  Ticket,
  TicketPlus,
  Calendar,
  CalendarCheck,
  Coins,
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Info,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
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

export type ToastType = "success" | "error" | "info";

const ToastContext = createContext<(msg: string, type?: ToastType) => void>(() => {});

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

type SubTab = "active" | "sell";
type PersTab = "view" | "book";

interface NavItem {
  icon: typeof Users;
  label: string;
  path: string;
  subTab?: SubTab;
  persTab?: PersTab;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: "Аналитика",
    items: [{ icon: LayoutDashboard, label: "Обзор", path: "/" }],
  },
  {
    label: "Гости & Баланс",
    items: [
      { icon: Users, label: "Все танцоры", path: "/clients" },
      { icon: Ticket, label: "Абонементы", path: "/subscriptions", subTab: "active" },
      { icon: TicketPlus, label: "Продать абонемент", path: "/subscriptions/sell", subTab: "sell" },
    ],
  },
  {
    label: "Занятия & Журналы",
    items: [
      { icon: Calendar, label: "Расписание уроков", path: "/schedule" },
      { icon: CalendarCheck, label: "Отметить класс", path: "/attendance" },
    ],
  },
  {
    label: "Личные занятия",
    items: [
      { icon: Sparkles, label: "Персональные", path: "/personal", persTab: "view" },
      { icon: TicketPlus, label: "Продать урок", path: "/personal/book", persTab: "book" },
    ],
  },
  {
    label: "Настройки & База",
    items: [{ icon: Coins, label: "Прайс-лист", path: "/prices" }],
  },
];

function getPanelTitle(pathname: string, subscriptionsTab: string, personalTab: string): string {
  if (pathname === "/") return "Обзор";
  if (pathname === "/clients") return "Клиенты";
  if (pathname.startsWith("/subscriptions")) {
    return subscriptionsTab === "sell" ? "Продажа абонемента" : "Действующие абонементы";
  }
  if (pathname === "/schedule") return "Расписание";
  if (pathname === "/attendance") return "Журнал посещений";
  if (pathname.startsWith("/personal")) {
    return personalTab === "book" ? "Продажа персонального урока" : "Персональные уроки";
  }
  if (pathname === "/prices") return "Тарифы и прайс-лист";
  return "TangoDB";
}

const TOAST_STYLES: Record<ToastType, { icon: typeof Info; accent: string }> = {
  success: { icon: CheckCircle2, accent: "text-emerald-600" },
  error: { icon: AlertTriangle, accent: "text-rose-600" },
  info: { icon: Info, accent: "text-indigo-500" },
};

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const subscriptionsTab = useUIStore((s) => s.subscriptionsTab);
  const personalTab = useUIStore((s) => s.personalTab);
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: ToastType = "info") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const panelTitle = getPanelTitle(location.pathname, subscriptionsTab, personalTab);

  useEffect(() => {
    document.title = `${panelTitle} · TangoDB`;
  }, [panelTitle]);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileDrawerOpen]);

  const go = (item: NavItem) => {
    setMobileDrawerOpen(false);
    if (item.subTab) setSubscriptionsTab(item.subTab);
    if (item.persTab) setPersonalTab(item.persTab);
    navigate(item.path);
  };

  const isItemActive = (item: NavItem) => {
    if (item.path === "/") return location.pathname === "/";
    if (item.path.startsWith("/subscriptions")) {
      return location.pathname.startsWith("/subscriptions") && subscriptionsTab === item.subTab;
    }
    if (item.path.startsWith("/personal")) {
      return location.pathname.startsWith("/personal") && personalTab === item.persTab;
    }
    return location.pathname === item.path;
  };

  const renderNav = () => (
    <nav className="relative flex-1 overflow-y-auto px-3 py-4 space-y-4">
      {NAV_SECTIONS.map((section) => (
        <div key={section.label} className="space-y-0.5">
          <p className="text-[9px] text-slate-400 font-sans tracking-wider uppercase font-semibold px-3 mb-1">
            {section.label}
          </p>
          {section.items.map((item) => {
            const active = isItemActive(item);
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => go(item)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold tracking-wide transition-all cursor-pointer ${
                  active
                    ? "bg-indigo-50 text-indigo-700 font-semibold border-l-2 border-indigo-600 pl-2.5"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" /> {item.label}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );

  const ToastIcon = toast ? TOAST_STYLES[toast.type].icon : Info;

  return (
    <ToastContext.Provider value={showToast}>
      <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 text-slate-800 antialiased font-sans">
        <aside className="hidden md:flex flex-col w-64 bg-white text-slate-700 border-r border-slate-200 flex-shrink-0 relative z-30 shadow-xs">
          <div
            onClick={() => go({ icon: LayoutDashboard, label: "Обзор", path: "/" })}
            className="relative px-5 py-4.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors flex items-center gap-3.5"
          >
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-sans font-semibold text-sm shadow-xs">
              T
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-slate-800 leading-tight">TangoDB</h1>
              <p className="text-[9px] font-sans tracking-widest text-slate-400 uppercase mt-0.5">STUDIO CONTROLLER</p>
            </div>
          </div>

          {renderNav()}

          <div className="p-4 border-t border-slate-100 text-center text-[10px] text-slate-400 font-sans">
            © TangoDB Studio Controller
          </div>
        </aside>

        {/* Mobile bottom tab bar: most frequent daily actions */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white border-t border-slate-200 z-40 flex justify-around items-center px-2 shadow-md pb-[env(safe-area-inset-bottom)]">
          {[
            { icon: LayoutDashboard, label: "Обзор", path: "/" } as NavItem,
            { icon: Ticket, label: "Абонементы", path: "/subscriptions", subTab: "active" } as NavItem,
            { icon: CalendarCheck, label: "Журнал", path: "/attendance" } as NavItem,
            { icon: Sparkles, label: "Персональные", path: "/personal", persTab: "view" } as NavItem,
          ].map((item) => {
            const active =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path.split("/").slice(0, 2).join("/"));
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => go(item)}
                className={`flex flex-col items-center gap-1 px-2 py-1 cursor-pointer transition-colors ${
                  active ? "text-indigo-600" : "text-slate-400"
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[9px] font-semibold uppercase tracking-wide leading-none">{item.label}</span>
              </button>
            );
          })}
        </div>

        <main className="flex-1 flex flex-col min-h-screen pb-16 md:pb-0 font-sans">
          <header className="sticky top-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between z-20 shadow-xs">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileDrawerOpen(true)}
                aria-label="Открыть меню"
                className="md:hidden p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg cursor-pointer transition-all"
              >
                <Menu className="w-5 h-5" />
              </button>
              <h2 className="text-base font-semibold text-slate-800 tracking-tight leading-tight">{panelTitle}</h2>
            </div>
            <button
              onClick={() => signOut()}
              className="hidden sm:flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Выйти
            </button>
          </header>

          <section className="flex-1 p-4 sm:p-6 md:p-8 xl:p-10 max-w-7xl w-full mx-auto space-y-8 overflow-y-auto">
            <Outlet />
          </section>
        </main>

        <AnimatePresence>
          {mobileDrawerOpen && (
            <div className="fixed inset-0 z-50 flex md:hidden">
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileDrawerOpen(false)}
                className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs"
              />
              <motion.div
                initial={{ x: -288 }}
                animate={{ x: 0 }}
                exit={{ x: -288 }}
                transition={{ type: "tween", duration: 0.2 }}
                className="relative flex flex-col w-72 max-w-[85vw] bg-white text-slate-700 h-full border-r border-slate-200 shadow-xl"
              >
                <div className="flex justify-between items-center px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 bg-indigo-600 rounded flex items-center justify-center text-white font-sans font-semibold text-xs">
                      T
                    </div>
                    <h3 className="text-sm font-semibold tracking-tight text-slate-800">TangoDB</h3>
                  </div>
                  <button
                    onClick={() => setMobileDrawerOpen(false)}
                    aria-label="Закрыть меню"
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg bg-slate-50 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {renderNav()}

                <div className="p-3 border-t border-slate-100">
                  <button
                    onClick={() => signOut()}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" /> Выйти
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="fixed bottom-20 md:bottom-8 right-4 left-4 md:left-auto max-w-sm md:w-96 bg-white border border-slate-200 text-slate-800 text-xs font-normal rounded-xl px-4 py-3 shadow-lg z-[60] flex items-center gap-3"
              role="status"
            >
              <ToastIcon className={`w-4.5 h-4.5 shrink-0 ${TOAST_STYLES[toast.type].accent}`} />
              <span className="flex-1 leading-snug">{toast.msg}</span>
              <button
                onClick={() => setToast(null)}
                aria-label="Закрыть уведомление"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
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
