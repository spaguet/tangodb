import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePermissions } from "../hooks/usePermissions";
import { useEnsureOwnMemberProfile } from "../hooks/useEnsureOwnMemberProfile";
import { useApplyScheduledSubscriptionMemberChanges } from "../hooks/useApplyScheduledSubscriptionMemberChanges";
import { useGuestI18n } from "../hooks/useI18n";
import { getOrganizationIdFromSession, isRenterActorFromSession } from "../lib/authClaims";
import { isSyntheticTelegramEmail } from "../lib/telegram";
import {
  findFirstAccessibleSettingsSection,
  findFirstEnabledAccessiblePanelPath,
  panelIdFromPath,
  settingsSectionFromPath,
  canAccessSettingsSection,
  canAccessFinanceNav,
  canAccessPayrollRoute,
  canAccessRentalInboxRoute,
  permissionOptionsFromSettings,
} from "../lib/permissions";
import {
  isModuleEnabled,
  moduleKeyFromPanel,
  moduleKeyFromSettingsSection,
  normalizeOrgModules,
} from "../lib/orgModules";

export function RenterActorDenied() {
  const { t } = useGuestI18n();
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center space-y-4">
        <p className="text-sm text-slate-600">{t("auth.renterActor.crmDenied")}</p>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-sm font-semibold text-indigo-600 hover:text-indigo-700"
        >
          {t("auth.renterActor.signOut")}
        </button>
      </div>
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <div className="w-8 h-8 rounded-full border-4 border-indigo-200 border-t-indigo-600 animate-spin" />
        <p className="text-xs font-sans font-semibold tracking-widest uppercase">{label}</p>
      </div>
    </div>
  );
}

/** CRM workspace boot — skeleton shell instead of a full-screen error-like flash. */
function CrmWorkspaceLoading() {
  const { t } = useGuestI18n();
  return (
    <div
      className="min-h-screen bg-slate-50 flex flex-col font-sans"
      role="status"
      aria-busy="true"
      aria-label={t("common.loading.default")}
    >
      <div className="h-14 border-b border-slate-200 bg-white px-4 flex items-center gap-3 shadow-xs">
        <div className="h-9 w-9 rounded-lg bg-slate-200/80 animate-pulse md:hidden" />
        <div className="h-4 w-36 max-w-[50vw] rounded bg-slate-200/80 animate-pulse" />
        <div className="ml-auto h-8 w-24 rounded-lg bg-slate-200/80 animate-pulse hidden sm:block" />
      </div>
      <div className="flex-1 p-4 sm:p-6 max-w-7xl mx-auto w-full space-y-4">
        <div className="h-7 w-48 max-w-full rounded bg-slate-200/80 animate-pulse" />
        <div className="h-28 rounded-xl border border-slate-100 bg-white shadow-xs animate-pulse" />
        <div className="h-40 rounded-xl border border-slate-100 bg-white shadow-xs animate-pulse" />
        <div className="h-32 rounded-xl border border-slate-100 bg-white shadow-xs animate-pulse hidden sm:block" />
      </div>
    </div>
  );
}

/** Recovery JWT must not open the CRM shell — only /auth/reset-password. */
export function RecoveryGate({ children }: { children: React.ReactNode }) {
  const { t } = useGuestI18n();
  const { passwordRecovery, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label={t("auth.loading.checkingSession")} />;
  if (passwordRecovery && location.pathname !== "/auth/reset-password") {
    return <Navigate to="/auth/reset-password" replace />;
  }
  return <>{children}</>;
}

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { t } = useGuestI18n();
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label={t("auth.loading.checkingSession")} />;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export function GuestRoute({ children }: { children: React.ReactNode }) {
  const { t } = useGuestI18n();
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen label={t("common.loading.default")} />;
  if (session) {
    if (isRenterActorFromSession(session)) {
      return <RenterActorDenied />;
    }
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/** `/register` — allow an existing session; RegisterPage handles «continue / not me». */
export function RegisterRoute({ children }: { children: React.ReactNode }) {
  const { t } = useGuestI18n();
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen label={t("common.loading.default")} />;
  if (session && isRenterActorFromSession(session)) {
    return <RenterActorDenied />;
  }
  return <>{children}</>;
}

const AUTH_FLOW_PATHS = new Set([
  "/activate-key",
  "/select-organization",
  "/register",
  "/accept-invite",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
]);

export function AuthFlowRoute() {
  const { t } = useGuestI18n();
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label={t("auth.loading.checkingSession")} />;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  if (isRenterActorFromSession(session)) {
    return <RenterActorDenied />;
  }
  return <Outlet />;
}

export function OrgWorkspaceRoute() {
  const { t } = useGuestI18n();
  const { session, loading: authLoading } = useAuth();
  const {
    memberships,
    membershipsLoading,
    organizationId,
    organization,
    orgLoading,
    needsOnboarding,
    mustSelectOrganization,
  } = useOrganization();
  useEnsureOwnMemberProfile();
  useApplyScheduledSubscriptionMemberChanges();
  const location = useLocation();
  const jwtOrganizationId = getOrganizationIdFromSession(session);

  if (authLoading || membershipsLoading) {
    return <CrmWorkspaceLoading />;
  }

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;

  if (isRenterActorFromSession(session)) {
    return <RenterActorDenied />;
  }

  if (memberships.length === 0) {
    if (location.pathname === "/activate-key") return <Outlet />;
    if (location.pathname === "/onboarding" && jwtOrganizationId) return <Outlet />;
    if (isSyntheticTelegramEmail(session.user.email)) {
      return <Navigate to="/activate-key" replace />;
    }
    // Email users without an org: create self-service demo first; activate-key only after demo quota is used.
    return <Navigate to="/auth/verify-email" replace />;
  }

  if (mustSelectOrganization) {
    if (AUTH_FLOW_PATHS.has(location.pathname)) return <Outlet />;
    return <Navigate to="/select-organization" replace />;
  }

  if (!organizationId) {
    if (AUTH_FLOW_PATHS.has(location.pathname)) return <Outlet />;
    return <Navigate to="/select-organization" replace />;
  }

  if (orgLoading) return <CrmWorkspaceLoading />;

  if (needsOnboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (!needsOnboarding && location.pathname === "/onboarding") {
    return <Navigate to="/" replace />;
  }

  if (organization?.status === "suspended") {
    const path = location.pathname;
    const licenseRecovery =
      path === "/license-required" || path === "/settings/license";
    if (!licenseRecovery) {
      return <Navigate to="/license-required" replace />;
    }
  }

  return <Outlet />;
}

export function PanelAccessRoute() {
  const location = useLocation();
  const { canAccessPanel, role, scope, isReadOnly, membership } = usePermissions();
  const { settings, claimsMismatch } = useOrganization();
  const panel = panelIdFromPath(location.pathname);
  const settingsSection = settingsSectionFromPath(location.pathname);
  const modules = normalizeOrgModules(settings?.modules);

  const options = permissionOptionsFromSettings(settings, scope, {
    restrictedAdmin: membership?.meta?.restricted_admin ?? false,
    isReadOnly,
  });

  if (claimsMismatch && (settingsSection || panel === "finance")) {
    const fallbackPath = findFirstEnabledAccessiblePanelPath(role, modules, options);
    return <Navigate to={fallbackPath ?? "/"} replace />;
  }

  if (settingsSection) {
    const settingsModuleKey = moduleKeyFromSettingsSection(settingsSection);
    if (settingsModuleKey && !isModuleEnabled(modules, settingsModuleKey)) {
      const fallbackSection = findFirstAccessibleSettingsSection(role, modules, options);
      return <Navigate to={fallbackSection ? `/settings/${fallbackSection}` : "/"} replace />;
    }
    if (!canAccessSettingsSection(role, settingsSection, options)) {
      const fallbackSection = findFirstAccessibleSettingsSection(role, modules, options);
      const notice = settingsSection === "team" ? { settingsAccessNotice: "team" as const } : undefined;
      return (
        <Navigate
          to={fallbackSection ? `/settings/${fallbackSection}` : "/"}
          replace
          state={notice}
        />
      );
    }
    return <Outlet />;
  }

  const panelModuleKey = moduleKeyFromPanel(panel);
  if (panelModuleKey && !isModuleEnabled(modules, panelModuleKey)) {
    const fallbackPath = findFirstEnabledAccessiblePanelPath(role, modules, options);
    return <Navigate to={fallbackPath ?? "/"} replace />;
  }

  const isFinanceRoot =
    location.pathname === "/finance" || location.pathname === "/finance/";
  if (isFinanceRoot && canAccessFinanceNav(role, modules, options)) {
    return <Outlet />;
  }

  const isPayrollRoute = location.pathname.startsWith("/finance/payroll");
  if (isPayrollRoute && canAccessPayrollRoute(role, modules, options)) {
    return <Outlet />;
  }

  const isRentalInboxRoute =
    location.pathname.startsWith("/finance/rental-inbox") ||
    location.pathname.startsWith("/finance/renter-topup");
  if (isRentalInboxRoute && canAccessRentalInboxRoute(role, modules, options)) {
    return <Outlet />;
  }

  if (!canAccessPanel(panel)) {
    if (panel === "dashboard") {
      const fallbackPath = findFirstEnabledAccessiblePanelPath(role, modules, options);
      if (fallbackPath) return <Navigate to={fallbackPath} replace />;
      return <Outlet />;
    }
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
