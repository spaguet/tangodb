import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useI18n } from "../../hooks/useI18n";

export default function ReadOnlyBanner() {
  const { isReadOnly, organization } = useOrganization();
  const { t, formatDate } = useI18n();

  if (!isReadOnly) return null;

  const purgeSuffix = organization?.data_purge_at
    ? ` ${t("common.readOnly.untilPurge", { date: formatDate(organization.data_purge_at) })}`
    : "";

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="flex items-start gap-2 text-sm text-amber-700">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          {organization?.status === "demo_retention"
            ? t("common.readOnly.demoRetention")
            : t("common.readOnly.demoExpired")}
          {purgeSuffix}.
        </span>
      </div>
      <Link
        to="/license-required"
        className="text-xs font-semibold uppercase tracking-wide text-amber-700 underline underline-offset-2 shrink-0"
      >
        {t("common.readOnly.activateLicense")}
      </Link>
    </div>
  );
}
