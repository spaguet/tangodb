import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useCrmSubscriptionUi } from "../../hooks/useCrmSubscriptionUi";
import { isDemoOrgStatus } from "../../lib/demoLicense";
import { useI18n } from "../../hooks/useI18n";

export default function ReadOnlyBanner() {
  const { isReadOnly, organization } = useOrganization();
  const { t, formatDate } = useI18n();
  const { writeClosed, graceDaysLeft, canPurchase, purchasePath } = useCrmSubscriptionUi();

  if (!isReadOnly) return null;

  const isDemoReadOnly = isDemoOrgStatus(organization?.status);
  const isSubscriptionReadOnly = writeClosed && !isDemoReadOnly;

  if (isSubscriptionReadOnly) {
    const message =
      graceDaysLeft && graceDaysLeft > 0
        ? t("common.readOnly.subscriptionGrace", { count: graceDaysLeft })
        : t("common.readOnly.subscriptionExpired");

    return (
      <div className="bg-amber-50 border-b border-amber-100 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-start gap-2 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{message}</span>
        </div>
        {canPurchase && (
          <Link
            to={purchasePath}
            className="text-xs font-semibold uppercase tracking-wide text-amber-900 underline underline-offset-2 shrink-0"
          >
            {t("common.readOnly.renewSubscription")}
          </Link>
        )}
      </div>
    );
  }

  const purgeSuffix = organization?.data_purge_at
    ? ` ${t("common.readOnly.untilPurge", { date: formatDate(organization.data_purge_at) })}`
    : "";

  return (
    <div className="bg-amber-50 border-b border-amber-100 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="flex items-start gap-2 text-sm text-amber-900">
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
        className="text-xs font-semibold uppercase tracking-wide text-amber-900 underline underline-offset-2 shrink-0"
      >
        {t("common.readOnly.activateLicense")}
      </Link>
    </div>
  );
}
