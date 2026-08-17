import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2 } from "lucide-react";
import { useOrganization } from "../organization/OrganizationProvider";
import { useGuestI18n } from "../hooks/useI18n";
import {
  AuthError,
  AuthLayout,
} from "./AuthLayout";

export default function SelectOrganizationPage() {
  const { t } = useGuestI18n();
  const navigate = useNavigate();
  const { memberships, setActiveOrganization } = useOrganization();
  const [error, setError] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

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

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.selectOrg.subtitle")}>
      <p className="text-sm text-ink-500">{t("auth.selectOrg.hint")}</p>
      <AuthError message={error} />

      <div className="space-y-2">
        {memberships.map((membership) => {
          const org = membership.organization;
          const label = org?.name ?? membership.display_name ?? membership.organization_id;
          const status = org?.status ?? "licensed";
          return (
            <button
              key={membership.id}
              type="button"
              disabled={!!loadingId}
              onClick={() => handleSelect(membership.organization_id)}
              className="w-full flex items-center gap-3 rounded-lg border border-ink-200 px-4 py-3 text-left hover:border-gold-300 hover:bg-gold-50/40 transition-colors cursor-pointer disabled:opacity-60"
            >
              <div className="w-9 h-9 rounded-lg bg-gold-100 text-gold-700 flex items-center justify-center shrink-0">
                <Building2 className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-800 truncate">{label}</p>
                <p className="text-xs text-ink-500 uppercase tracking-wide">
                  {membership.role} · {status.replace("_", " ")}
                </p>
              </div>
              {loadingId === membership.organization_id && (
                <span className="w-4 h-4 rounded-full border-2 border-gold-200 border-t-gold-600 animate-spin" />
              )}
            </button>
          );
        })}
      </div>
    </AuthLayout>
  );
}
