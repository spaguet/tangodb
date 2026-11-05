import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { APP_VERSION } from "../../lib/appVersion";
import OrgSwitcher from "../../organization/OrgSwitcher";
import OfflineBanner from "../../components/ui/OfflineBanner";
import ReadOnlyBanner from "../../components/ui/ReadOnlyBanner";
import CrmSubscriptionRenewalBanner from "../../components/license/CrmSubscriptionRenewalBanner";
import GoogleCalendarSyncStoppedNotifier from "../../components/integrations/GoogleCalendarSyncStoppedNotifier";
import ClaimsMismatchBanner from "../../components/ui/ClaimsMismatchBanner";
import SettingsAccessNotice from "../../settings/components/SettingsAccessNotice";
import OfflineReconciliationDialog from "../../components/offline/OfflineReconciliationDialog";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import {
  useInvalidateAfterOfflineSync,
  useOfflineReconciliation,
  useOfflineSecurityReset,
  useOfflineShiftLoader,
  useOfflineShiftMeta,
} from "../../hooks/useOfflineShift";
import { useOfflineStore } from "../../store/offline";
import { reportOfflineEvent } from "../../lib/offline/monitoring";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrgEdition } from "../../hooks/useOrgEdition";
import { useI18n } from "../../hooks/useI18n";
import { useDismissOnRouteChange } from "../../hooks/useDismissOnRouteChange";
import { getNavSections, getPanelTitle, type NavItem } from "../../lib/i18n";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules } from "../../lib/orgModules";
import DemoBrandBadge from "../../components/demo/DemoBrandBadge";
import LocaleDocumentSync from "../../components/LocaleDocumentSync";
import AccountBeginnerHintsMenu from "../../components/onboarding/AccountBeginnerHintsMenu";
import PanelBeginnerHelpButton from "../../components/onboarding/PanelBeginnerHelpButton";
import { ToastContext, TOAST_STYLES, type ToastType } from "../../lib/toastContext";
import { buildPhoneNavModel, phoneTabLabel, type PhoneBottomTab } from "./phoneNav";
import PhoneMoreSheet from "./PhoneMoreSheet";
import PhoneApkUpdateBanner from "./PhoneApkUpdateBanner";
import PhoneWebBundleBridge from "./PhoneWebBundleBridge";
import NativeShellBridge from "./NativeShellBridge";
import PhoneNotificationsBridge from "./PhoneNotificationsBridge";
import PhoneNotificationsCard from "./PhoneNotificationsCard";
import PhoneAttendancePanel from "./PhoneAttendancePanel";
import PhoneSchedulePanel from "./PhoneSchedulePanel";
import DashboardPage from "../../pages/DashboardPage";
import { PhoneOfflineExitGuardProvider } from "./PhoneOfflineExitGuard";
import { useUIStore } from "../../store/ui";
import PhoneRouteSync from "./PhoneRouteSync";

function PhonePanelBody({ pathname }: { pathname: string }) {
  if (pathname === "/") return <DashboardPage />;
  if (pathname === "/attendance") return <PhoneAttendancePanel />;
  if (pathname === "/schedule") return <PhoneSchedulePanel />;
  return <Outlet />;
}

export default function PhoneAppLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { role, options: permissionOptions } = usePermissions();
  const { editionAllows } = useOrgEdition();
  const subscriptionsTab = useUIStore((s) => s.subscriptionsTab);
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);
  const { settings, claimsMismatch } = useOrganization();
  const orgModules = normalizeOrgModules(settings?.modules);

  const [moreOpen, setMoreOpen] = useState(false);
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
  const allNavItems = useMemo(() => navSections.flatMap((section) => section.items), [navSections]);
  const phoneNav = useMemo(
    () =>
      buildPhoneNavModel(allNavItems, {
        role,
        orgModules,
        permissionOptions,
        editionAllows,
        claimsMismatch,
      }),
    [allNavItems, role, orgModules, permissionOptions, editionAllows, claimsMismatch]
  );

  const panelTitle = getPanelTitle(location.pathname, subscriptionsTab, t);

  useEffect(() => {
    document.title = `${panelTitle} · TangoDB`;
  }, [panelTitle]);

  const setReconciliationOpen = useOfflineStore((s) => s.setReconciliationOpen);

  useDismissOnRouteChange(() => {
    setMoreOpen(false);
    setReconciliationOpen(false);
  });

  const connectionRestoredHandledRef = useRef(false);
  const prevJustConnectionRestoredRef = useRef(false);

  useEffect(() => {
    const wasRestored = prevJustConnectionRestoredRef.current;
    prevJustConnectionRestoredRef.current = justConnectionRestored;

    if (!justConnectionRestored) {
      connectionRestoredHandledRef.current = false;
      return;
    }

    if (wasRestored || connectionRestoredHandledRef.current) return;
    connectionRestoredHandledRef.current = true;

    showToast(t("nav.connectionRestored"), "success");
    reportOfflineEvent("connection_restored");
    const pendingTotal = counts.pending + counts.conflict + counts.failed;
    if (pendingTotal > 0) {
      void invalidateAfterOfflineSync().then(() => openReconciliation());
    }
  }, [justConnectionRestored, showToast, t, invalidateAfterOfflineSync, openReconciliation, counts]);

  const isItemActive = (item: NavItem) => {
    if (item.path === "/") return location.pathname === "/";
    if (item.path === "/finance") return location.pathname.startsWith("/finance");
    if (item.path === "/settings/team") return location.pathname.startsWith("/settings/team");
    if (item.path === "/settings") {
      return location.pathname.startsWith("/settings") && !location.pathname.startsWith("/settings/team");
    }
    if (item.path.startsWith("/subscriptions")) {
      return location.pathname.startsWith("/subscriptions");
    }
    if (item.path.startsWith("/personal")) {
      return location.pathname.startsWith("/personal");
    }
    return location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
  };

  const goNavItem = (item: NavItem) => {
    setMoreOpen(false);
    if (item.subTab) setSubscriptionsTab(item.subTab);
    if (item.personalSubTab) setPersonalTab(item.personalSubTab);
    navigate(item.path);
  };

  const goTab = (tab: PhoneBottomTab) => {
    if (tab.path === "__more__") {
      setMoreOpen(true);
      return;
    }
    if (tab.subTab) setSubscriptionsTab(tab.subTab);
    navigate(tab.path);
  };

  const isTabActive = (tab: PhoneBottomTab) => {
    if (tab.path === "__more__") return moreOpen;
    if (tab.path === "/") return location.pathname === "/";
    if (tab.path === "/finance") return location.pathname.startsWith("/finance");
    return location.pathname === tab.path || location.pathname.startsWith(`${tab.path}/`);
  };

  const ToastIcon = toast ? TOAST_STYLES[toast.type].icon : TOAST_STYLES.info.icon;

  return (
    <PhoneOfflineExitGuardProvider>
    <ToastContext.Provider value={showToast}>
      <LocaleDocumentSync />
      <PhoneRouteSync />
      <NativeShellBridge />
      <PhoneNotificationsBridge />
      <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 antialiased font-sans">
        <main className="flex-1 flex flex-col min-h-screen min-w-0 pb-[calc(4rem+env(safe-area-inset-bottom,0px))] font-sans">
          <header className="sticky top-0 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between z-20 shadow-xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 bg-indigo-600 rounded flex items-center justify-center text-white font-sans font-semibold text-[11px] tracking-tight leading-none shadow-xs shrink-0">
                TDB
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-slate-800 tracking-tight leading-tight truncate">
                  {panelTitle}
                </h2>
                <DemoBrandBadge compact />
              </div>
              <PanelBeginnerHelpButton />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <OrgSwitcher />
              <AccountBeginnerHintsMenu />
            </div>
          </header>

          <PhoneApkUpdateBanner />
          <PhoneWebBundleBridge />

          <OfflineBanner
            connectionState={connectionState}
            pendingCount={counts.pending + counts.failed}
            conflictCount={counts.conflict}
            snapshotSyncedAt={snapshotMeta.syncedAt}
            onOpenReconciliation={openReconciliation}
          />
          <ReadOnlyBanner />
          <CrmSubscriptionRenewalBanner />
          <GoogleCalendarSyncStoppedNotifier />
          <ClaimsMismatchBanner />
          <SettingsAccessNotice />

          <OfflineReconciliationDialog
            open={reconciliationOpen}
            onClose={closeReconciliation}
            onComplete={() => void invalidateAfterOfflineSync()}
          />

          <section className="flex-1 min-w-0 p-4 sm:p-5 pb-8 max-w-7xl w-full mx-auto panel-page-stack overflow-y-auto overflow-x-hidden">
            {location.pathname === "/" ? (
              <div className="space-y-4">
                <PhoneNotificationsCard />
                <PhonePanelBody pathname={location.pathname} />
              </div>
            ) : (
              <PhonePanelBody pathname={location.pathname} />
            )}
          </section>

          <footer className="px-4 pb-2 text-center text-[10px] text-slate-400">
            v{APP_VERSION} · {t("phone.footer.tagline")}
          </footer>
        </main>

        <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-slate-200 bg-white shadow-md pb-[env(safe-area-inset-bottom)]">
          {phoneNav.bottomTabs.map((tab) => {
            const Icon = tab.icon;
            const active = isTabActive(tab);
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => goTab(tab)}
                className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 cursor-pointer transition-colors ${
                  active ? "text-indigo-600" : "text-slate-400"
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="text-[11px] font-semibold leading-none text-center">
                  {phoneTabLabel(tab, t)}
                </span>
              </button>
            );
          })}
        </nav>

        <PhoneMoreSheet
          open={moreOpen}
          items={phoneNav.moreItems}
          onClose={() => setMoreOpen(false)}
          onPick={goNavItem}
          isActive={isItemActive}
        />

        {createPortal(
          <AnimatePresence>
            {toast && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={{ duration: 0.18 }}
                className="fixed bottom-[4.5rem] right-4 left-4 max-w-sm bg-white border border-slate-200 text-slate-800 text-xs font-normal rounded-xl px-4 py-3 shadow-lg z-[250] flex items-center gap-3"
                role="status"
              >
                <ToastIcon className={`w-4.5 h-4.5 shrink-0 ${TOAST_STYLES[toast.type].accent}`} />
                <span className="flex-1 leading-snug">{toast.msg}</span>
                <button
                  type="button"
                  onClick={() => setToast(null)}
                  aria-label={t("nav.aria.closeToast")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
      </div>
    </ToastContext.Provider>
    </PhoneOfflineExitGuardProvider>
  );
}
