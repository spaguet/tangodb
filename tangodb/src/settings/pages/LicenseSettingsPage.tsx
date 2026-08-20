import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, KeyRound, LifeBuoy, Shield } from "lucide-react";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import DeveloperContacts from "../../components/license/DeveloperContacts";
import ManualPurchasePanel from "../../components/license/ManualPurchasePanel";
import SubscriptionWaitlistCard from "../../components/license/SubscriptionWaitlistCard";
import { usePlatformPaymentConfig } from "../../hooks/usePlatformPaymentConfig";
import { useToast } from "../../App";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useActivateAccessKey } from "../../hooks/useActivateAccessKey";
import { isDemoOrgStatus } from "../../lib/demoLicense";
import DemoPurchaseCta from "../../components/demo/DemoPurchaseCta";
import { useI18n } from "../../hooks/useI18n";
import type { I18nKey } from "../../lib/i18n/keys";

const STATUS_TONES: Record<string, string> = {
  demo_active: "text-indigo-700 bg-indigo-50 border-indigo-100",
  demo_retention: "text-amber-800 bg-amber-50 border-amber-100",
  licensed: "text-indigo-700 bg-indigo-50 border-indigo-100",
  suspended: "text-slate-600 bg-slate-100 border-slate-200",
  purged: "text-slate-500 bg-slate-50 border-slate-200",
};

const STATUS_KEYS: Record<string, I18nKey> = {
  demo_active: "license.status.demoActive",
  demo_retention: "license.status.demoRetention",
  licensed: "license.status.licensed",
  suspended: "license.status.suspended",
  purged: "license.status.purged",
};

const SUBSCRIPTION_STATUS_KEYS: Record<string, I18nKey> = {
  active: "license.subscription.active",
  past_due: "license.subscription.pastDue",
  canceled: "license.subscription.canceled",
};

const BILLING_PERIOD_KEYS: Record<string, I18nKey> = {
  monthly: "license.billing.monthly",
  yearly: "license.billing.yearly",
};

export default function LicenseSettingsPage() {
  const { t, formatDate } = useI18n();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { organization, orgLoading, license, subscription, refreshOrganization } = useOrganization();
  const { config: paymentConfig } = usePlatformPaymentConfig(true);
  const activateKey = useActivateAccessKey();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loading = activateKey.isPending;

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      toast(t("license.checkout.success"), "success");
      void refreshOrganization();
      searchParams.delete("checkout");
      setSearchParams(searchParams, { replace: true });
    } else if (checkout === "cancelled" || checkout === "canceled") {
      toast(t("license.checkout.cancelled"), "info");
      searchParams.delete("checkout");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, toast, refreshOrganization, t]);

  if (orgLoading || !organization) return <LoadingState label={t("license.loading")} />;

  const isLifetime = license?.license_type === "lifetime";
  const hasSubscription = license?.license_type === "subscription" && !!subscription;
  const statusKey = STATUS_KEYS[organization.status] ?? STATUS_KEYS.suspended;
  const statusTone = STATUS_TONES[organization.status] ?? STATUS_TONES.suspended;
  const isDemo = isDemoOrgStatus(organization.status);
  const isPurchaseFlow = searchParams.get("purchase") === "1";
  const showManualPurchase = isPurchaseFlow && isDemo;
  const canSubscribe = !isLifetime && organization.status !== "suspended";

  const forgotPasswordLinkText = t("license.ownerRecovery.forgotPasswordLink");
  const forgotPasswordParts = t("license.ownerRecovery.forgotPassword").split(forgotPasswordLinkText);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      const data = await activateKey.mutateAsync(key.trim());
      await refreshOrganization();
      setKey("");
      toast(
        data.upgraded ? t("license.activate.successUpgraded") : t("license.activate.success"),
        "success"
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : t("license.activate.errorGeneric");
      if (message === "Invalid access key") {
        setError(t("license.activate.invalidKey"));
      } else if (message === "activation_failed") {
        setError(t("license.activate.errorGeneric"));
      } else {
        setError(message);
      }
    }
  };

  return (
    <div className="panel-card-stack max-w-xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {showManualPurchase ? t("license.title.purchase") : t("license.title.default")}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {showManualPurchase ? t("license.subtitle.purchase") : t("license.subtitle.default")}
          </p>
        </div>
        {isDemo && !isPurchaseFlow && <DemoPurchaseCta variant="banner" />}
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
        <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${statusTone}`}>
          {isLifetime || (hasSubscription && subscription?.status === "active") ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          ) : isDemo && organization.status === "demo_retention" ? (
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          ) : (
            <Shield className="w-5 h-5 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1 text-sm">
            <p className="font-semibold">
              {isLifetime
                ? t("license.lifetime")
                : hasSubscription
                  ? t("license.subscription.title", {
                      status:
                        t(SUBSCRIPTION_STATUS_KEYS[subscription!.status] ?? "license.subscription.active"),
                    })
                  : t(statusKey)}
            </p>
            {organization.demo_expires_at && isDemo && organization.status === "demo_active" && (
              <p className="text-xs opacity-80">
                {t("license.demoUntil", { date: formatDate(organization.demo_expires_at) })}
              </p>
            )}
            {organization.data_purge_at && isDemo && (
              <p className="text-xs opacity-80">
                {t("license.purgeScheduled", { date: formatDate(organization.data_purge_at) })}
              </p>
            )}
            {isLifetime && (
              <p className="text-xs opacity-80">{t("license.lifetime.grandfatheringNote")}</p>
            )}
            {hasSubscription && subscription?.current_period_end && (
              <p className="text-xs opacity-80">
                {t("license.subscription.periodUntil", {
                  date: formatDate(subscription.current_period_end),
                  period:
                    t(BILLING_PERIOD_KEYS[subscription.billing_period] ?? "license.billing.monthly"),
                })}
              </p>
            )}
            {hasSubscription && subscription?.status === "past_due" && (
              <p className="text-xs opacity-80 text-amber-800">
                {t("license.subscription.pastDueReadOnly")}
              </p>
            )}
          </div>
        </div>

        {showManualPurchase && (
          <RequirePermission action="license.activate" mode="hide">
            <ManualPurchasePanel />
          </RequirePermission>
        )}

        {canSubscribe && !isLifetime && (
          <RequirePermission action="license.activate" mode="hide">
            <SubscriptionWaitlistCard />
          </RequirePermission>
        )}

        {!isLifetime && (
          <RequirePermission action="license.activate" mode="hide">
            <form onSubmit={handleActivate} className="space-y-3 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500 flex items-start gap-2">
                <KeyRound className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                {showManualPurchase ? t("license.activate.hintPurchase") : t("license.activate.hintLifetime")}
              </p>
              {error && (
                <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
              )}
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="TDB-LIFE-XXXX-XXXX-XXXX"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <button
                type="submit"
                disabled={loading || !key.trim()}
                className="w-full py-2.5 border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-50"
              >
                {loading ? t("license.activate.submitting") : t("license.activate.submit")}
              </button>
            </form>
          </RequirePermission>
        )}

        {organization.status === "demo_retention" && (
          <p className="text-xs text-slate-500">
            <Link to="/license-required" className="text-indigo-600 hover:underline">
              {t("license.readOnlyLearnMore")}
            </Link>
          </p>
        )}

        <DeveloperContacts contacts={paymentConfig.contacts} />

        <div className="border-t border-slate-100 pt-4 space-y-2">
          <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-sky-600" />
            {t("license.ownerRecovery.title")}
          </h3>
          <ul className="text-xs text-slate-600 space-y-1.5 list-disc pl-4 leading-relaxed">
            <li>
              {forgotPasswordParts[0]}
              <Link to="/auth/forgot-password" className="text-indigo-600 hover:underline">
                {forgotPasswordLinkText}
              </Link>
              {forgotPasswordParts[1]}
            </li>
            <li>{t("license.ownerRecovery.lostEmail")}</li>
            <li className="text-slate-500">{t("license.ownerRecovery.emailChangeNote")}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
