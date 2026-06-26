import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, KeyRound, Shield } from "lucide-react";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import DeveloperContacts from "../../components/license/DeveloperContacts";
import ManualPurchasePanel from "../../components/license/ManualPurchasePanel";
import SubscriptionWaitlistCard from "../../components/license/SubscriptionWaitlistCard";
import { usePlatformPaymentConfig } from "../../hooks/usePlatformPaymentConfig";
import { useToast } from "../../App";
import { useOrganization } from "../../organization/OrganizationProvider";
import { supabase } from "../../lib/supabase";
import { isDemoOrgStatus } from "../../lib/demoLicense";
import DemoPurchaseCta from "../../components/demo/DemoPurchaseCta";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  demo_active: { label: "Демо (активно)", tone: "text-indigo-700 bg-indigo-50 border-indigo-100" },
  demo_retention: { label: "Демо (только просмотр)", tone: "text-amber-800 bg-amber-50 border-amber-100" },
  licensed: { label: "Лицензия активна", tone: "text-indigo-700 bg-indigo-50 border-indigo-100" },
  suspended: { label: "Приостановлено", tone: "text-slate-600 bg-slate-100 border-slate-200" },
  purged: { label: "Данные удалены", tone: "text-slate-500 bg-slate-50 border-slate-200" },
};

const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Оплачено",
  past_due: "Просрочена оплата",
  canceled: "Отменена",
};

const BILLING_PERIOD_LABELS: Record<string, string> = {
  monthly: "Ежемесячно",
  yearly: "Ежегодно",
};

export default function LicenseSettingsPage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const { organization, orgLoading, license, subscription, refreshOrganization } = useOrganization();
  const { config: paymentConfig } = usePlatformPaymentConfig(true);
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkout = searchParams.get("checkout");
    if (checkout === "success") {
      toast("Оплата принята — обновляем статус подписки", "success");
      void refreshOrganization();
      searchParams.delete("checkout");
      setSearchParams(searchParams, { replace: true });
    } else if (checkout === "cancelled" || checkout === "canceled") {
      toast("Оплата отменена", "info");
      searchParams.delete("checkout");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, toast, refreshOrganization]);

  if (orgLoading || !organization) return <LoadingState label="Загрузка лицензии..." />;

  const isLifetime = license?.license_type === "lifetime";
  const hasSubscription = license?.license_type === "subscription" && !!subscription;
  const statusInfo = STATUS_LABELS[organization.status] ?? STATUS_LABELS.suspended;
  const isDemo = isDemoOrgStatus(organization.status);
  const isPurchaseFlow = searchParams.get("purchase") === "1";
  const showManualPurchase = isPurchaseFlow && isDemo;
  const canSubscribe = !isLifetime && organization.status !== "suspended";

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("activate-access-key", {
        body: { key: key.trim() },
      });

      if (fnError) {
        const ctx = (fnError as { context?: Response }).context;
        if (ctx) {
          try {
            const body = await ctx.json();
            if (body?.error) throw new Error(body.error);
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== fnError.message) throw parseErr;
          }
        }
        throw fnError;
      }

      if (!data?.ok) {
        throw new Error(data?.error ?? "Не удалось активировать ключ");
      }

      await supabase.auth.refreshSession();
      await refreshOrganization();
      setKey("");
      toast(data.upgraded ? "Лицензия активирована, данные сохранены" : "Лицензия активирована", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось активировать ключ";
      setError(message === "Invalid access key" ? "Неверный или уже использованный ключ" : message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-card-stack max-w-xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            {showManualPurchase ? "Покупка полной версии" : "Лицензия и тариф"}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {showManualPurchase
              ? "Выберите способ оплаты или активируйте полученный ключ ниже."
              : "Статус доступа, подписка SaaS или пожизненная лицензия по ключу."}
          </p>
        </div>
        {isDemo && !isPurchaseFlow && <DemoPurchaseCta variant="banner" />}
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
        <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${statusInfo.tone}`}>
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
                ? "Пожизненная лицензия"
                : hasSubscription
                  ? `Подписка — ${SUBSCRIPTION_STATUS_LABELS[subscription!.status] ?? subscription!.status}`
                  : statusInfo.label}
            </p>
            {organization.demo_expires_at && isDemo && organization.status === "demo_active" && (
              <p className="text-xs opacity-80">Демо до {formatDate(organization.demo_expires_at)}</p>
            )}
            {organization.data_purge_at && isDemo && (
              <p className="text-xs opacity-80">Данные будут удалены {formatDate(organization.data_purge_at)}</p>
            )}
            {isLifetime && (
              <p className="text-xs opacity-80">
                Grandfathering: пожизненный доступ сохранён. Обновления внутри версии CRM — бесплатно.
              </p>
            )}
            {hasSubscription && subscription?.current_period_end && (
              <p className="text-xs opacity-80">
                Период до {formatDate(subscription.current_period_end)} (
                {BILLING_PERIOD_LABELS[subscription.billing_period] ?? subscription.billing_period})
              </p>
            )}
            {hasSubscription && subscription?.status === "past_due" && (
              <p className="text-xs opacity-80 text-amber-800">
                CRM доступна только для просмотра до восстановления оплаты.
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
                {showManualPurchase
                  ? "Активировать полную версию — введите lifetime-ключ из письма."
                  : "Или введите lifetime-ключ для пожизненного доступа."}
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
                {loading ? "Активация..." : "Активировать ключ"}
              </button>
            </form>
          </RequirePermission>
        )}

        {organization.status === "demo_retention" && (
          <p className="text-xs text-slate-500">
            <Link to="/license-required" className="text-indigo-600 hover:underline">
              Подробнее о режиме только для чтения
            </Link>
          </p>
        )}

        {!showManualPurchase && <DeveloperContacts contacts={paymentConfig.contacts} />}
      </div>
    </div>
  );
}
