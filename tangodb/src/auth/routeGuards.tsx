import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { useOrganization } from "../organization/OrganizationProvider";
import { usePermissions } from "../hooks/usePermissions";
import { panelIdFromPath } from "../lib/permissions";

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

  if (authLoading || membershipsLoading) {
    return <LoadingScreen label="Загрузка профиля..." />;
  }

  if (!session) return <Navigate to="/login" replace state={{ from: location }} />;

  if (memberships.length === 0) {
    if (location.pathname === "/activate-key") return <Outlet />;
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
  const { canAccessPanel } = usePermissions();
  const panel = panelIdFromPath(location.pathname);

  if (!canAccessPanel(panel)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
