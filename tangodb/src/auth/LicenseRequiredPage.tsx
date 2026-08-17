import { Link } from "react-router-dom";
import { AlertTriangle, KeyRound, ShoppingBag } from "lucide-react";
import { useOrganization } from "../organization/OrganizationProvider";
import { DEMO_PURCHASE_PATH } from "../lib/demoLicense";
import { formatDateLocale } from "../lib/i18n";
import { useGuestI18n } from "../hooks/useI18n";
import { AuthLayout, AuthLink } from "./AuthLayout";

export default function LicenseRequiredPage() {
  const { t, locale } = useGuestI18n();
  const { organization, role } = useOrganization();
  const showPurchaseCta = role === "owner" || role === "director";

  const formatDate = (iso: string | null | undefined): string => {
    if (!iso) return "—";
    return formatDateLocale(iso, locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("license.required.subtitle")}>
      <div className="flex items-start gap-3 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-3">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">{t("license.required.demoEndedTitle")}</p>
          <p>{t("license.required.readOnlyHint")}</p>
          {organization?.data_purge_at && (
            <p className="text-xs text-amber-700">
              {new Date(organization.data_purge_at) <= new Date()
                ? t("license.required.purgeSoon", { date: formatDate(organization.data_purge_at) })
                : t("license.required.purgeScheduled", { date: formatDate(organization.data_purge_at) })}
            </p>
          )}
        </div>
      </div>

      {showPurchaseCta && (
        <Link
          to={DEMO_PURCHASE_PATH}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-gold-700 text-white hover:bg-gold-800 transition-colors"
        >
          <ShoppingBag className="w-4 h-4" />
          {t("demo.purchaseCta")}
        </Link>
      )}

      <Link
        to="/activate-key"
        className={`w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
          showPurchaseCta
            ? "border border-gold-200 text-gold-700 hover:bg-gold-50"
            : "bg-gold-700 text-white hover:bg-gold-800"
        }`}
      >
        <KeyRound className="w-4 h-4" />
        {t("license.required.activateKey")}
      </Link>

      <p className="text-sm text-ink-500 text-center">
        <AuthLink to="/">{t("license.required.backToReadOnlyCrm")}</AuthLink>
      </p>
    </AuthLayout>
  );
}
