import { Link } from "react-router-dom";
import { AlertTriangle, KeyRound, ShoppingBag } from "lucide-react";
import DeveloperContacts from "../components/license/DeveloperContacts";
import { usePlatformPaymentConfig } from "../hooks/usePlatformPaymentConfig";
import { useOrganization } from "../organization/OrganizationProvider";
import { DEMO_PURCHASE_PATH, isDemoOrgStatus } from "../lib/demoLicense";
import {
  LIFETIME_PURCHASE_PATH,
  MONTHLY_PURCHASE_PATH,
} from "../lib/crmLicensePurchase";
import { formatDateLocale } from "../lib/i18n";
import { useGuestI18n } from "../hooks/useI18n";
import { AuthLayout, AuthLink } from "./AuthLayout";

export default function LicenseRequiredPage() {
  const { t, locale } = useGuestI18n();
  const { organization, role, license } = useOrganization();
  const { config: paymentConfig } = usePlatformPaymentConfig(true);

  const isOwner = role === "owner";
  const isStrategic = role === "owner" || role === "director";
  const isSuspended = organization?.status === "suspended";
  const isDemoRetention = organization?.status === "demo_retention";
  const hadCrmSubscription = license?.license_type === "subscription";

  const showBackToReadOnly = !isSuspended && (isDemoRetention || isDemoOrgStatus(organization?.status));

  const formatDate = (iso: string | null | undefined): string => {
    if (!iso) return "—";
    return formatDateLocale(iso, locale, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  };

  const titleKey = isSuspended
    ? hadCrmSubscription
      ? "license.required.subscriptionEndedTitle"
      : "license.required.suspendedTitle"
    : "license.required.demoEndedTitle";

  const hintKey = isSuspended
    ? hadCrmSubscription
      ? "license.required.subscriptionEndedHint"
      : "license.required.suspendedHint"
    : "license.required.readOnlyHint";

  return (
    <AuthLayout title="TangoDB" subtitle={t("license.required.subtitle")}>
      <div className="flex items-start gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-3">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">{t(titleKey)}</p>
          <p>{t(hintKey)}</p>
          {organization?.data_purge_at && isDemoRetention && (
            <p className="text-xs text-amber-700/80">
              {new Date(organization.data_purge_at) <= new Date()
                ? t("license.required.purgeSoon", { date: formatDate(organization.data_purge_at) })
                : t("license.required.purgeScheduled", { date: formatDate(organization.data_purge_at) })}
            </p>
          )}
        </div>
      </div>

      {isStrategic && isSuspended && (
        <div className="space-y-2">
          <Link
            to={MONTHLY_PURCHASE_PATH}
            className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
          >
            <ShoppingBag className="w-4 h-4" />
            {t("license.required.payMonthCta")}
          </Link>
          <Link
            to={LIFETIME_PURCHASE_PATH}
            className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors"
          >
            <ShoppingBag className="w-4 h-4" />
            {t("license.required.buyLifetimeCta")}
          </Link>
        </div>
      )}

      {isStrategic && isDemoRetention && (
        <Link
          to={DEMO_PURCHASE_PATH}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <ShoppingBag className="w-4 h-4" />
          {t("demo.purchaseCta")}
        </Link>
      )}

      {isOwner && (
        <Link
          to="/activate-key"
          className={`w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
            isStrategic && (isSuspended || isDemoRetention)
              ? "border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
              : "bg-indigo-600 text-white hover:bg-indigo-700"
          }`}
        >
          <KeyRound className="w-4 h-4" />
          {t("license.required.activateKey")}
        </Link>
      )}

      {!isStrategic && (
        <div className="space-y-3 text-sm text-slate-600">
          <p>{t("license.required.accessPausedContact")}</p>
          <DeveloperContacts contacts={paymentConfig.contacts} embedded />
        </div>
      )}

      {showBackToReadOnly && (
        <p className="text-sm text-slate-500 text-center">
          <AuthLink to="/">{t("license.required.backToReadOnlyCrm")}</AuthLink>
        </p>
      )}
    </AuthLayout>
  );
}
