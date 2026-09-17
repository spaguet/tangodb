import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { useOrganization } from "../organization/OrganizationProvider";
import { useGuestI18n } from "../hooks/useI18n";
import { useAuth } from "./AuthProvider";
import { memberRoleLabel } from "../hooks/useTeamMembers";
import {
  organizationMembershipLabel,
  organizationStatusLabel,
} from "../lib/organizationDisplayName";
import {
  AuthError,
  AuthLayout,
  AuthLink,
} from "./AuthLayout";

export default function SelectOrganizationPage() {
  const { t, locale } = useGuestI18n();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { memberships, membershipsLoading, setActiveOrganization } = useOrganization();
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    document.title = t("auth.selectOrg.pageTitle");
  }, [t, locale]);

  const handleSelect = async (organizationId: string) => {
    setLoadingId(organizationId);
    setError(null);
    try {
      await setActiveOrganization(organizationId);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.selectOrg.error"));
    } finally {
      setLoadingId(null);
    }
  };

  const handleNotMe = async () => {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.selectOrg.error"));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.selectOrg.subtitle")}>
      <p className="text-sm text-slate-500">{t("auth.selectOrg.hint")}</p>
      <AuthError message={error} />

      {membershipsLoading && (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <div className="w-4 h-4 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
          {t("auth.loading.profile")}
        </div>
      )}

      <div className="space-y-2">
        {memberships.map((membership) => {
          const org = membership.organization;
          const label = organizationMembershipLabel(membership);
          const status = org?.status ?? "licensed";
          const roleLabel = memberRoleLabel(membership.role, membership.meta, locale);
          const statusLabel = organizationStatusLabel(status, locale);
          return (
            <button
              key={membership.id}
              type="button"
              disabled={!!loadingId || signingOut}
              onClick={() => handleSelect(membership.organization_id)}
              className="w-full flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left hover:border-indigo-300 hover:bg-indigo-50/40 transition-colors cursor-pointer disabled:opacity-60"
            >
              <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 truncate">{label}</p>
                <p className="text-xs text-slate-500">
                  {roleLabel}
                  {statusLabel ? ` · ${statusLabel}` : null}
                </p>
              </div>
              {loadingId === membership.organization_id && (
                <span className="w-4 h-4 rounded-full border-2 border-indigo-200 border-t-indigo-600 animate-spin" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t border-slate-100">
        <AuthLink to="/activate-key">{t("auth.register.hasLicenseKey")}</AuthLink>
        <AuthLink to="/register">{t("auth.register.newStudio")}</AuthLink>
        <button
          type="button"
          disabled={signingOut || !!loadingId}
          onClick={() => void handleNotMe()}
          className="text-sm font-semibold text-slate-600 hover:text-slate-800 text-left cursor-pointer disabled:opacity-60"
        >
          {t("auth.register.notMe")}
        </button>
      </div>
    </AuthLayout>
  );
}
