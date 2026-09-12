import { useEffect, useMemo, useState } from "react";
import LoadingState from "../ui/LoadingState";
import {
  useCreatePurchaseQuote,
  type CreatePurchaseQuoteResult,
} from "../../hooks/useCreatePurchaseQuote";
import { usePlatformPaymentConfig } from "../../hooks/usePlatformPaymentConfig";
import { useI18n } from "../../hooks/useI18n";
import { useOrganization } from "../../organization/OrganizationProvider";
import {
  parsePurchasePlanParam,
  resolveSelectedSku,
  type PurchaseSkuLock,
} from "../../lib/crmLicensePurchase";
import type { PlatformPaymentSku } from "../../lib/paymentConfig";
import { listPaymentMethodChoices, methodChoiceLabel } from "../../lib/paymentMethodChoices";
import PurchaseActivationInstructions from "./PurchaseActivationInstructions";
import PurchaseRequestPanel from "./PurchaseRequestPanel";
import QuotedPaymentDetails from "./QuotedPaymentDetails";

interface ManualPurchasePanelProps {
  skuLock?: PurchaseSkuLock;
  planPrefill?: string | null;
}

export default function ManualPurchasePanel({
  skuLock = "choice",
  planPrefill = null,
}: ManualPurchasePanelProps) {
  const { t } = useI18n();
  const { organization } = useOrganization();
  const { config, hasContent, isLoading, isError } = usePlatformPaymentConfig(true);
  const createQuote = useCreatePurchaseQuote();
  const [userSku, setUserSku] = useState<PlatformPaymentSku | "">("");
  const [selectedMethodCode, setSelectedMethodCode] = useState("");
  const [quote, setQuote] = useState<CreatePurchaseQuoteResult | null>(null);
  const [quoteNonce, setQuoteNonce] = useState(0);

  const plan = parsePurchasePlanParam(planPrefill);
  const selectedSku = resolveSelectedSku(skuLock, plan, userSku);
  const methodChoices = useMemo(() => listPaymentMethodChoices(config), [config]);
  const methodSelected = Boolean(selectedMethodCode.trim());

  const quoteMatchesSelection =
    Boolean(quote) &&
    Boolean(selectedSku) &&
    methodSelected &&
    quote?.method_code === selectedMethodCode;

  useEffect(() => {
    if (!organization || !selectedSku || !methodSelected) {
      setQuote(null);
      return;
    }

    let cancelled = false;
    setQuote(null);
    void createQuote
      .mutateAsync({
        organizationId: organization.id,
        sku: selectedSku,
        methodCode: selectedMethodCode,
      })
      .then((nextQuote) => {
        if (!cancelled) setQuote(nextQuote);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      });

    return () => {
      cancelled = true;
    };
    // quoteNonce retriggers after a successful submit so the next request gets a fresh quote.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mutation object is unstable
  }, [organization?.id, selectedSku, selectedMethodCode, quoteNonce]);

  const mapQuoteError = (message: string): string => {
    if (message === "purge_window_too_short" || message === "demo_purge_deadline_passed") {
      return t("license.purchase.quotePurgeWindow");
    }
    if (message === "lifetime_org_monthly_forbidden") {
      return t("license.purchase.quoteLifetimeMonthlyForbidden");
    }
    if (message === "monthly_not_configured" || message === "invalid_sku") {
      return t("license.purchase.noMethodsConfigured");
    }
    return t("license.purchase.request.quoteError");
  };

  if (isLoading) {
    return <LoadingState label={t("license.purchase.loadingMethods")} />;
  }

  const lifetimePrice = config.crmLifetime;
  const monthlyPrice = config.crmMonthly;
  const formatPrice = (amount?: string, currency?: string) =>
    [amount, currency].filter(Boolean).join(" ");

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4">
      <PurchaseActivationInstructions sku={selectedSku} />

      {skuLock === "choice" ? (
        <fieldset className="space-y-2">
          <legend className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
            {t("license.plan.selectTitle")}
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-3 cursor-pointer hover:border-indigo-200 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50">
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="purchase-sku"
                  value="crm_license"
                  checked={selectedSku === "crm_license"}
                  onChange={() => {
                    setUserSku("crm_license");
                    setSelectedMethodCode("");
                  }}
                  className="text-indigo-600"
                />
                <span className="text-sm font-semibold text-slate-900">{t("license.plan.lifetime")}</span>
              </span>
              <span className="pl-6 text-xs text-slate-500">
                {lifetimePrice
                  ? t("license.plan.price", {
                      amount: lifetimePrice.amount,
                      currency: lifetimePrice.currency,
                    })
                  : t("license.plan.lifetimeHint")}
              </span>
            </label>
            <label className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-3 cursor-pointer hover:border-indigo-200 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50">
              <span className="flex items-center gap-2">
                <input
                  type="radio"
                  name="purchase-sku"
                  value="crm_subscription"
                  checked={selectedSku === "crm_subscription"}
                  onChange={() => {
                    setUserSku("crm_subscription");
                    setSelectedMethodCode("");
                  }}
                  className="text-indigo-600"
                />
                <span className="text-sm font-semibold text-slate-900">{t("license.plan.monthly")}</span>
              </span>
              <span className="pl-6 text-xs text-slate-500">
                {monthlyPrice
                  ? t("license.plan.price", {
                      amount: monthlyPrice.amount,
                      currency: monthlyPrice.currency,
                    })
                  : t("license.plan.monthlyHint")}
              </span>
            </label>
          </div>
        </fieldset>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
          {t("license.plan.monthly")}
          {monthlyPrice ? ` · ${formatPrice(monthlyPrice.amount, monthlyPrice.currency)}` : ""}
        </div>
      )}

      {selectedSku ? (
        methodChoices.length > 0 ? (
          <fieldset className="space-y-2">
            <legend className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
              {t("license.purchase.request.methodLabel")}
            </legend>
            <div className="space-y-1.5">
              {methodChoices.map((choice) => (
                <label
                  key={choice.methodCode}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 cursor-pointer hover:border-indigo-200 has-[:checked]:border-indigo-400 has-[:checked]:bg-indigo-50/50"
                >
                  <input
                    type="radio"
                    name="purchase-payment-method"
                    value={choice.methodCode}
                    checked={selectedMethodCode === choice.methodCode}
                    onChange={() => setSelectedMethodCode(choice.methodCode)}
                    className="text-indigo-600"
                  />
                  <span className="text-xs text-slate-800">{methodChoiceLabel(choice, t)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {t("license.purchase.noMethodsConfigured")}
          </p>
        )
      ) : (
        <p className="text-xs text-slate-500">{t("license.purchase.skuRequired")}</p>
      )}

      {isError && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {t("license.purchase.loadError")}
        </p>
      )}

      {!isError && !hasContent && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          {t("license.purchase.noMethodsConfigured")}
        </p>
      )}

      {selectedSku && methodSelected && createQuote.isPending ? (
        <LoadingState label={t("license.purchase.creatingQuote")} />
      ) : null}

      {createQuote.isError ? (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {mapQuoteError(createQuote.error instanceof Error ? createQuote.error.message : "")}
        </p>
      ) : null}

      {quoteMatchesSelection && quote ? (
        <QuotedPaymentDetails
          config={config}
          methodCode={quote.method_code}
          amount={quote.amount}
          currency={quote.currency}
          paymentDetails={quote.payment_details}
        />
      ) : null}

      {quoteMatchesSelection && quote ? (
        <PurchaseRequestPanel
          contacts={config.contacts}
          quoteId={quote.quote_id}
          onSubmitted={() => setQuoteNonce((value) => value + 1)}
        />
      ) : null}
    </div>
  );
}
