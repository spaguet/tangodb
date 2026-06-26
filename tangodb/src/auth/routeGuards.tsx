import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePermissions } from "../hooks/usePermissions";
import { getOrganizationIdFromSession } from "../lib/authClaims";
import {
  findFirstAccessibleSettingsSection,
  findFirstEnabledAccessiblePanelPath,
  panelIdFromPath,
  settingsSectionFromPath,
  canAccessSettingsSection,
  permissionOptionsFromSettings,
} from "../lib/permissions";
import {
  isModuleEnabled,
  moduleKeyFromPanel,
  moduleKeyFromSettingsSection,
  normalizeOrgModules,
} from "../lib/orgModules";

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

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label="Проверка сессии..." />;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return <>{children}</>;
}

export function GuestRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();

  if (loading) return <LoadingScreen label="Загрузка..." />;
  if (session) return <Navigate to="/" replace />;
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
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) return <LoadingScreen label="Проверка сессии..." />;
  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function OrgWorkspaceRoute() {
  const { session, loading: authLoading } = useAuth();
  const {
    memberships,
    membershipsLoading,
    organizationId,
    orgLoading,
    needsOnboarding,
  } = useOrganization();
  const location = useLocation();
  const jwtOrganizationId = getOrganizationIdFromSession(session);

  if (authLoading || membershipsLoading) {
    return <LoadingScreen label="Загрузка профиля..." />;
  }

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;

  if (memberships.length === 0) {
    if (location.pathname === "/activate-key") return <Outlet />;
    if (location.pathname === "/onboarding" && jwtOrganizationId) return <Outlet />;
    const emailConfirmed = Boolean(session.user.email_confirmed_at);
    const hasEmail = Boolean(session.user.email?.trim());
    if (emailConfirmed && hasEmail) {
      return <Navigate to="/auth/verify-email" replace />;
    }
    return <Navigate to="/activate-key" replace />;
  }

  if (!organizationId) {
    if (AUTH_FLOW_PATHS.has(location.pathname)) return <Outlet />;
    return <Navigate to="/select-organization" replace />;
  }

  if (orgLoading) return <LoadingScreen label="Загрузка организации..." />;

  if (needsOnboarding && location.pathname !== "/onboarding") {
    return <Navigate to="/onboarding" replace />;
  }

  if (!needsOnboarding && location.pathname === "/onboarding") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}

export function PanelAccessRoute() {
  const location = useLocation();
  const { canAccessPanel, role, scope, isReadOnly, membership } = usePermissions();
  const { settings } = useOrganization();
  const panel = panelIdFromPath(location.pathname);
  const settingsSection = settingsSectionFromPath(location.pathname);
  const modules = normalizeOrgModules(settings?.modules);

  const options = permissionOptionsFromSettings(settings, scope, {
    restrictedAdmin: membership?.meta?.restricted_admin ?? false,
    isReadOnly,
  });

  if (settingsSection) {
    const settingsModuleKey = moduleKeyFromSettingsSection(settingsSection);
    if (settingsModuleKey && !isModuleEnabled(modules, settingsModuleKey)) {
      const fallbackSection = findFirstAccessibleSettingsSection(role, modules, options);
      return <Navigate to={fallbackSection ? `/settings/${fallbackSection}` : "/"} replace />;
    }
    if (!canAccessSettingsSection(role, settingsSection, options)) {
      const fallbackSection = findFirstAccessibleSettingsSection(role, modules, options);
      return <Navigate to={fallbackSection ? `/settings/${fallbackSection}` : "/"} replace />;
    }
  }

  const panelModuleKey = moduleKeyFromPanel(panel);
  if (panelModuleKey && !isModuleEnabled(modules, panelModuleKey)) {
    const fallbackPath = findFirstEnabledAccessiblePanelPath(role, modules, options);
    return <Navigate to={fallbackPath ?? "/"} replace />;
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
