import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronDown } from "lucide-react";
import { useOrganization } from "../organization/OrganizationProvider";
import { useI18n } from "../hooks/useI18n";

export default function OrgSwitcher() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const { memberships, organization, setActiveOrganization } = useOrganization();
  const [open, setOpen] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  if (memberships.length <= 1) return null;

  const handleSwitch = async (organizationId: string) => {
    if (organizationId === organization?.id) {
      setOpen(false);
      return;
    }

    setLoadingId(organizationId);
    try {
      await setActiveOrganization(organizationId);
      setOpen(false);
      navigate("/", { replace: true });
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 max-w-[220px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 cursor-pointer"
      >
        <Building2 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
        <span className="truncate">{organization?.name ?? t("orgSwitcher.defaultName")}</span>
        <ChevronDown className="w-3.5 h-3.5 shrink-0" />
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label={t("orgSwitcher.closeMenu")}
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-lg border border-slate-200 bg-white shadow-lg py-1">
            {memberships.map((membership) => {
              const label = membership.organization?.name ?? membership.display_name ?? membership.organization_id;
              const active = membership.organization_id === organization?.id;
              return (
                <button
                  key={membership.id}
                  type="button"
                  disabled={!!loadingId}
                  onClick={() => handleSwitch(membership.organization_id)}
                  className={`w-full px-3 py-2 text-left text-xs hover:bg-slate-50 cursor-pointer disabled:opacity-60 ${
                    active ? "text-indigo-700 bg-indigo-50/60" : "text-slate-700"
                  }`}
                >
                  <span className="font-semibold block truncate">{label}</span>
                  <span className="text-slate-400 uppercase tracking-wide">{membership.role}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                navigate("/select-organization");
              }}
              className="w-full px-3 py-2 text-left text-xs text-indigo-600 hover:bg-indigo-50 border-t border-slate-100 cursor-pointer"
            >
              {t("orgSwitcher.allOrgs")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
