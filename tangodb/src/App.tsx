import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Menu,
  X,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  Info,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { AuthProvider, useAuth } from "./auth/AuthProvider";
import {
  AuthFlowRoute,
  GuestRoute,
  OrgWorkspaceRoute,
  PanelAccessRoute,
} from "./auth/ProtectedRoute";
import LoginPage from "./auth/LoginPage";
import RegisterPage from "./auth/RegisterPage";
import ForgotPasswordPage from "./auth/ForgotPasswordPage";
import ResetPasswordPage from "./auth/ResetPasswordPage";
import VerifyEmailPage from "./auth/VerifyEmailPage";
import ActivateKeyPage from "./auth/ActivateKeyPage";
import SelectOrganizationPage from "./auth/SelectOrganizationPage";
import LicenseRequiredPage from "./auth/LicenseRequiredPage";
import AcceptInvitePage from "./auth/AcceptInvitePage";
import OnboardingWizardPage from "./auth/OnboardingWizardPage";
import { OrganizationProvider } from "./organization/OrganizationProvider";
import { SettingsProvider } from "./settings/SettingsProvider";
import SettingsLayout from "./settings/SettingsLayout";
import SettingsIndexRedirect from "./settings/SettingsIndexRedirect";
import GeneralSettingsPage from "./settings/pages/GeneralSettingsPage";
import OrganizationSettingsPage from "./settings/pages/OrganizationSettingsPage";
import SubscriptionSettingsPage from "./settings/pages/SubscriptionSettingsPage";
import DisciplinesSettingsPage from "./settings/pages/DisciplinesSettingsPage";
import HallRentSettingsPage, { VenueCostsLegacyRedirect } from "./settings/pages/HallRentSettingsPage";
import LocationsSettingsPage from "./settings/pages/LocationsSettingsPage";
import DataExportPage from "./settings/pages/DataExportPage";
import TeamSettingsPage from "./settings/pages/TeamSettingsPage";
import LicenseSettingsPage from "./settings/pages/LicenseSettingsPage";
import OrgSwitcher from "./organization/OrgSwitcher";
import { useUIStore } from "./store/ui";
import DashboardPage from "./pages/DashboardPage";
import ClientsPage from "./pages/ClientsPage";
import RentersPage from "./pages/RentersPage";
import SubscriptionsPage from "./pages/SubscriptionsPage";
import SchedulePage from "./pages/SchedulePage";
import PersonalLessonsPage from "./pages/PersonalLessonsPage";
import AttendancePage from "./pages/AttendancePage";
import PricesPage from "./pages/PricesPage";
import FinancePage from "./pages/FinancePage";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import OfflineBanner from "./components/ui/OfflineBanner";
import ReadOnlyBanner from "./components/ui/ReadOnlyBanner";
import OfflineReconciliationDialog from "./components/offline/OfflineReconciliationDialog";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import {
  useInvalidateAfterOfflineSync,
  useOfflineReconciliation,
  useOfflineSecurityReset,
  useOfflineShiftLoader,
  useOfflineShiftMeta,
} from "./hooks/useOfflineShift";
import { useOfflineStore } from "./store/offline";
import { reportOfflineEvent } from "./lib/offline/monitoring";
import { usePermissions } from "./hooks/usePermissions";
import { useI18n } from "./hooks/useI18n";
import {
  getNavSections,
  getMobileTabs,
  getPanelTitle,
  type NavItem,
  type MobileTabItem,
} from "./lib/i18n";
import { panelIdFromPath, canAccessSettingsSection, permissionOptionsFromSettings, canAccessFinanceNav } from "./lib/permissions";
import { useOrganization } from "./organization/OrganizationProvider";
import { normalizeOrgModules } from "./lib/orgModules";
import DemoBrandBadge from "./components/demo/DemoBrandBadge";
import LocaleDocumentSync from "./components/LocaleDocumentSync";
import DemoPurchaseCta from "./components/demo/DemoPurchaseCta";
import { useDemoLicenseUi } from "./hooks/useDemoLicenseUi";
import { usePlatformPaymentConfig } from "./hooks/usePlatformPaymentConfig";
import DeveloperContacts from "./components/license/DeveloperContacts";
import { btnHeaderSignOutCls } from "./components/ui/buttonStyles";

export type ToastType = "success" | "error" | "info";

const ToastContext = createContext<((msg: string, type?: ToastType) => void) | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within AppLayout");
  return ctx;
}

const TOAST_STYLES: Record<ToastType, { icon: typeof Info; accent: string }> = {
  success: { icon: CheckCircle2, accent: "text-indigo-600" },
  error: { icon: AlertTriangle, accent: "text-rose-600" },
  info: { icon: Info, accent: "text-indigo-500" },
};

function ScrollableNav({ children, refreshKey }: { children: React.ReactNode; refreshKey?: unknown }) {
  const { t } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  const updateScrollBtn = useCallback(() => {
    const el = navRef.current;
    if (!el) {
      setShowScrollBtn(false);
      return;
    }
    const overflows = el.scrollHeight > el.clientHeight + 2;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
    setShowScrollBtn(overflows && !atBottom);
  }, []);

  useEffect(() => {
    updateScrollBtn();
    const el = navRef.current;
    if (!el) return;

    el.addEventListener("scroll", updateScrollBtn, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(updateScrollBtn);
      ro.observe(el);
      return () => {
        el.removeEventListener("scroll", updateScrollBtn);
        ro.disconnect();
      };
    }

    return () => {
      el.removeEventListener("scroll", updateScrollBtn);
    };
  }, [updateScrollBtn]);

  useEffect(() => {
    updateScrollBtn();
    const timer = setTimeout(updateScrollBtn, 250);
    return () => clearTimeout(timer);
  }, [refreshKey, updateScrollBtn]);

  const scrollDown = () => {
    const el = navRef.current;
    if (!el) return;
    el.scrollBy({ top: el.clientHeight * 0.65, behavior: "smooth" });
  };

  return (
    <div className="relative flex-1 min-h-0">
      <nav ref={navRef} className="h-full overflow-y-auto px-3 py-4 space-y-4">
        {children}
      </nav>
      {showScrollBtn && (
        <button
          type="button"
          onClick={scrollDown}
          aria-label={t("nav.aria.scrollMenuDown")}
          className="absolute bottom-2 right-2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white border border-slate-200 shadow-md text-slate-600 hover:text-indigo-600 hover:border-indigo-200 cursor-pointer transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

function AppLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const { canAccessPanel, role, scope, isReadOnly, membership } = usePermissions();
  const subscriptionsTab = useUIStore((s) => s.subscriptionsTab);
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const personalTab = useUIStore((s) => s.personalTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);
  const { settings } = useOrganization();
  const { showPurchaseCta } = useDemoLicenseUi();
  const { config: paymentConfig } = usePlatformPaymentConfig(true);
  const orgModules = normalizeOrgModules(settings?.modules);
  const permissionOptions = permissionOptionsFromSettings(settings, scope, {
    restrictedAdmin: membership?.meta?.restricted_admin ?? false,
    isReadOnly,
  });

  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { connectionState, justConnectionRestored } = useOnlineStatus();
  useOfflineShiftLoader();
  useOfflineSecurityReset();
  const { counts, snapshotMeta } = useOfflineShiftMeta(connectionState);
  const reconciliationOpen = useOfflineStore((s) => s.reconciliationOpen);
  const { openReconciliation, closeReconciliation } = useOfflineReconciliation();
  const invalidateAfterOfflineSync = useInvalidateAfterOfflineSync();

  const showToast = useCallback((msg: string, type: ToastType = "info") => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ msg, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }, []);

  const navSections = getNavSections(t);
  const mobileTabs = getMobileTabs(t);
  const panelTitle = getPanelTitle(location.pathname, subscriptionsTab, t);

  useEffect(() => {
    document.title = `${panelTitle} · TangoDB`;
  }, [panelTitle]);

  useEffect(() => {
    if (!justConnectionRestored) return;
    showToast(t("nav.connectionRestored"), "success");
    reportOfflineEvent("connection_restored");
    const pendingTotal = counts.pending + counts.conflict + counts.failed;
    if (pendingTotal > 0) {
      void invalidateAfterOfflineSync().then(() => openReconciliation());
    }
  }, [justConnectionRestored, showToast, t, counts.pending, counts.conflict, counts.failed, invalidateAfterOfflineSync, openReconciliation]);

  useEffect(() => {
    if (!mobileDrawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileDrawerOpen]);

  const go = (item: NavItem | MobileTabItem) => {
    setMobileDrawerOpen(false);
    if (item.subTab) setSubscriptionsTab(item.subTab);
    if ("personalSubTab" in item && item.personalSubTab) setPersonalTab(item.personalSubTab);
    navigate(item.path);
  };

  const isItemActive = (item: NavItem) => {
    if (item.path === "/") return location.pathname === "/";
    if (item.path === "/finance") return location.pathname.startsWith("/finance");
    if (item.path === "/settings/team") return location.pathname.startsWith("/settings/team");
    if (item.path === "/settings") {
      return location.pathname.startsWith("/settings") && !location.pathname.startsWith("/settings/team");
    }
    if (item.path.startsWith("/subscriptions")) {
      // «История абонементов» keeps «Абонементы» highlighted in the sidebar
      if (item.subTab === "active") {
        return (
          location.pathname.startsWith("/subscriptions") &&
          (subscriptionsTab === "active" || subscriptionsTab === "history")
        );
      }
      return location.pathname.startsWith("/subscriptions") && subscriptionsTab === item.subTab;
    }
    if (item.path.startsWith("/personal")) {
      return location.pathname.startsWith("/personal") && personalTab === item.personalSubTab;
    }
    return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  };

  const renderNav = (refreshKey?: unknown, closeDrawer?: () => void) => (
    <ScrollableNav refreshKey={refreshKey ?? showPurchaseCta}>
      {showPurchaseCta && (
        <div className="px-3 pb-3 border-b border-slate-100 mb-1">
          <DemoPurchaseCta variant="nav" onNavigate={closeDrawer} />
        </div>
      )}
      {navSections.map((section) => {
        if (section.moduleKey && !orgModules[section.moduleKey]) return null;
        const visibleItems = section.items.filter((item) => {
          if (item.settingsSection) {
            return canAccessSettingsSection(role, item.settingsSection, permissionOptions);
          }
          if (item.path === "/finance") {
            return canAccessFinanceNav(role, orgModules, permissionOptions);
          }
          return canAccessPanel(panelIdFromPath(item.path));
        });
        if (visibleItems.length === 0) return null;

        return (
        <div key={section.label} className="space-y-0.5">
          <p className="text-[11px] text-slate-400 font-sans tracking-wider uppercase font-semibold px-3 mb-1">
            {section.label}
          </p>
          {visibleItems.map((item) => {
            const active = isItemActive(item);
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                onClick={() => go(item)}
                className={`w-full flex items-center justify-start gap-3 px-3 py-2 rounded-md text-xs font-semibold tracking-wide text-left transition-all cursor-pointer ${
                  active
                    ? "bg-indigo-50 text-indigo-700 font-semibold border-l-2 border-indigo-600 pl-2.5"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                }`}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="min-w-0 leading-snug">{item.label}</span>
              </button>
            );
          })}
        </div>
        );
      })}
    </ScrollableNav>
  );

  const ToastIcon = toast ? TOAST_STYLES[toast.type].icon : Info;

  return (
    <ToastContext.Provider value={showToast}>
      <LocaleDocumentSync />
      <RouteSync />
      <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 text-slate-800 antialiased font-sans">
        <aside className="hidden md:flex flex-col w-64 min-h-screen bg-white text-slate-700 border-r border-slate-200 flex-shrink-0 relative z-30 shadow-xs">
          <div
            onClick={() => go({ icon: LayoutDashboard, label: t("nav.item.dashboard"), path: "/" })}
            className="relative px-5 py-4.5 border-b border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors flex items-center gap-3.5"
          >
            <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-sans font-semibold text-[11px] tracking-tight leading-none shadow-xs">
              TDB
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold tracking-tight text-slate-800 leading-tight">TangoDB</h1>
              <p className="text-[11px] font-sans tracking-widest text-slate-400 uppercase mt-0.5">STUDIO CONTROLLER</p>
              <DemoBrandBadge />
            </div>
          </div>

          {renderNav()}

          <div className="p-4 border-t border-slate-100 text-center text-[10px] text-slate-400 font-sans">
            © TangoDB Studio Controller
          </div>
        </aside>

        {/* Mobile bottom tab bar: most frequent daily actions */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-white border-t border-slate-200 z-40 flex justify-around items-center px-0.5 shadow-md pb-[env(safe-area-inset-bottom)]">
          {mobileTabs.filter((item) => {
            if (item.moduleKey && !orgModules[item.moduleKey]) return false;
            return canAccessPanel(panelIdFromPath(item.path));
          }).map((item) => {
            const active =
              item.path === "/"
                ? location.pathname === "/"
                : location.pathname.startsWith(item.path.split("/").slice(0, 2).join("/"));
            const Icon = item.icon;
            return (
              <button
                key={`${item.path}-${item.line1}`}
                onClick={() => go(item)}
                className={`flex flex-col items-center justify-center gap-0.5 px-0.5 py-0 min-w-0 flex-1 cursor-pointer transition-colors ${
                  active ? "text-indigo-600" : "text-slate-400"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wide leading-none text-center">
                  {item.line1}
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wide leading-none text-center">
                  {item.line2}
                </span>
              </button>
            );
          })}
        </div>

        <main className="flex-1 flex flex-col min-h-screen pb-14 md:pb-0 font-sans">
          <header className="sticky top-0 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex items-center justify-between z-20 shadow-xs">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setMobileDrawerOpen(true)}
                aria-label={t("nav.aria.openMenu")}
                className="md:hidden p-1.5 text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg cursor-pointer transition-all"
              >
                <Menu className="w-5 h-5" />
              </button>
              <h2 className="text-base font-semibold text-slate-800 tracking-tight leading-tight">{panelTitle}</h2>
            </div>
            <div className="flex items-center gap-2">
              <OrgSwitcher />
              <div className="hidden lg:flex items-center gap-2">
                <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                  {t("nav.supportLabel")}
                </span>
                <DeveloperContacts contacts={paymentConfig.contacts} embedded />
              </div>
              <button
                onClick={() => signOut()}
                className={`hidden sm:inline-flex ${btnHeaderSignOutCls.replace(/^inline-flex /, "")}`}
              >
                <LogOut className="w-3.5 h-3.5" />
                {t("nav.signOut")}
              </button>
            </div>
          </header>

          <OfflineBanner
            connectionState={connectionState}
            pendingCount={counts.pending + counts.failed}
            conflictCount={counts.conflict}
            snapshotSyncedAt={snapshotMeta.syncedAt}
            onOpenReconciliation={openReconciliation}
          />
          <ReadOnlyBanner />

          <OfflineReconciliationDialog
            open={reconciliationOpen}
            onClose={closeReconciliation}
            onComplete={() => void invalidateAfterOfflineSync()}
          />

          <section className="flex-1 p-4 sm:p-5 md:p-6 xl:p-8 max-w-7xl w-full mx-auto panel-page-stack overflow-y-auto">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
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
                <div className="flex justify-between items-start px-5 py-4 border-b border-slate-100">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-7 h-7 bg-indigo-600 rounded flex items-center justify-center text-white font-sans font-semibold text-[10px] tracking-tight leading-none shrink-0">
                      TDB
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold tracking-tight text-slate-800 leading-tight">TangoDB</h3>
                      <DemoBrandBadge compact />
                    </div>
                  </div>
                  <button
                    onClick={() => setMobileDrawerOpen(false)}
                    aria-label={t("nav.aria.closeMenu")}
                    className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg bg-slate-50 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {renderNav(mobileDrawerOpen, () => setMobileDrawerOpen(false))}

                <div className="p-3 border-t border-slate-100">
                  <button
                    onClick={() => signOut()}
                    className="w-full inline-flex items-center gap-3 h-8 box-border px-3 rounded-md text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" /> {t("nav.signOut")}
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
              className="fixed bottom-[3.75rem] md:bottom-8 right-4 left-4 md:left-auto max-w-sm md:w-96 bg-white border border-slate-200 text-slate-800 text-xs font-normal rounded-xl px-4 py-3 shadow-lg z-[60] flex items-center gap-3"
              role="status"
            >
              <ToastIcon className={`w-4.5 h-4.5 shrink-0 ${TOAST_STYLES[toast.type].accent}`} />
              <span className="flex-1 leading-snug">{toast.msg}</span>
              <button
                onClick={() => setToast(null)}
                aria-label={t("nav.aria.closeToast")}
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
    else if (location.pathname === "/subscriptions/history") setSubscriptionsTab("history");
    else if (location.pathname === "/subscriptions") setSubscriptionsTab("active");
    else if (location.pathname === "/personal/sell") setPersonalTab("sell");
    else if (location.pathname.startsWith("/personal")) setPersonalTab("view");
  }, [location.pathname, setSubscriptionsTab, setPersonalTab]);

  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <OrganizationProvider>
          <SettingsProvider>
          <BrowserRouter>
            <Routes>
              <Route
                path="/login"
                element={
                  <GuestRoute>
                    <ErrorBoundary>
                      <LoginPage />
                    </ErrorBoundary>
                  </GuestRoute>
                }
              />
              <Route
                path="/register"
                element={
                  <GuestRoute>
                    <ErrorBoundary>
                      <RegisterPage />
                    </ErrorBoundary>
                  </GuestRoute>
                }
              />
              <Route path="/auth/forgot-password" element={<ErrorBoundary><ForgotPasswordPage /></ErrorBoundary>} />
              <Route path="/auth/reset-password" element={<ErrorBoundary><ResetPasswordPage /></ErrorBoundary>} />
              <Route path="/auth/verify-email" element={<ErrorBoundary><VerifyEmailPage /></ErrorBoundary>} />
              <Route path="/accept-invite" element={<ErrorBoundary><AcceptInvitePage /></ErrorBoundary>} />

              <Route element={<AuthFlowRoute />}>
                <Route path="/activate-key" element={<ErrorBoundary><ActivateKeyPage /></ErrorBoundary>} />
                <Route path="/select-organization" element={<ErrorBoundary><SelectOrganizationPage /></ErrorBoundary>} />
              </Route>

              <Route
                element={
                  <OrgWorkspaceRoute />
                }
              >
                <Route path="/onboarding" element={<ErrorBoundary><OnboardingWizardPage /></ErrorBoundary>} />
                <Route path="/license-required" element={<ErrorBoundary><LicenseRequiredPage /></ErrorBoundary>} />
                <Route element={<PanelAccessRoute />}>
                <Route element={<AppLayout />}>
                  <Route index element={<ErrorBoundary><DashboardPage /></ErrorBoundary>} />
                  <Route path="clients" element={<ErrorBoundary><ClientsPage /></ErrorBoundary>} />
                  <Route path="renters" element={<ErrorBoundary><RentersPage /></ErrorBoundary>} />
                  <Route path="renters/:renterId" element={<ErrorBoundary><RentersPage /></ErrorBoundary>} />
                  <Route path="subscriptions" element={<ErrorBoundary><SubscriptionsPage initialTab="active" /></ErrorBoundary>} />
                  <Route path="subscriptions/sell" element={<ErrorBoundary><SubscriptionsPage initialTab="sell" /></ErrorBoundary>} />
                  <Route path="subscriptions/history" element={<ErrorBoundary><SubscriptionsPage initialTab="history" /></ErrorBoundary>} />
                  <Route path="schedule" element={<ErrorBoundary><SchedulePage /></ErrorBoundary>} />
                  <Route path="attendance" element={<ErrorBoundary><AttendancePage /></ErrorBoundary>} />
                  <Route path="personal" element={<ErrorBoundary><PersonalLessonsPage initialTab="view" /></ErrorBoundary>} />
                  <Route path="personal/sell" element={<ErrorBoundary><PersonalLessonsPage initialTab="sell" /></ErrorBoundary>} />
                  <Route path="personal/book" element={<Navigate to="/personal/sell" replace />} />
                  <Route path="prices" element={<ErrorBoundary><PricesPage /></ErrorBoundary>} />
                  <Route path="finance/*" element={<ErrorBoundary><FinancePage /></ErrorBoundary>} />
                  <Route path="settings/team" element={<ErrorBoundary><TeamSettingsPage /></ErrorBoundary>} />
                  <Route path="settings" element={<ErrorBoundary><SettingsLayout /></ErrorBoundary>}>
                    <Route index element={<ErrorBoundary><SettingsIndexRedirect /></ErrorBoundary>} />
                    <Route path="general" element={<ErrorBoundary><GeneralSettingsPage /></ErrorBoundary>} />
                    <Route path="organization" element={<ErrorBoundary><OrganizationSettingsPage /></ErrorBoundary>} />
                    <Route path="subscriptions" element={<ErrorBoundary><SubscriptionSettingsPage /></ErrorBoundary>} />
                    <Route path="disciplines" element={<ErrorBoundary><DisciplinesSettingsPage /></ErrorBoundary>} />
                    <Route path="locations" element={<ErrorBoundary><LocationsSettingsPage /></ErrorBoundary>} />
                    <Route path="hall-rent" element={<ErrorBoundary><HallRentSettingsPage /></ErrorBoundary>} />
                    <Route path="rental-tariffs" element={<Navigate to="/settings/hall-rent" replace />} />
                    <Route path="venue-costs" element={<VenueCostsLegacyRedirect />} />
                    <Route path="data" element={<ErrorBoundary><DataExportPage /></ErrorBoundary>} />
                    <Route path="license" element={<ErrorBoundary><LicenseSettingsPage /></ErrorBoundary>} />
                  </Route>
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
          </SettingsProvider>
        </OrganizationProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
