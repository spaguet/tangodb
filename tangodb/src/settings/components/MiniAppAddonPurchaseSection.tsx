import { useState } from "react";
import { CreditCard, Send } from "lucide-react";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";
import { useSubmitPurchaseRequest } from "../../hooks/useSubmitPurchaseRequest";
import { useOrganization } from "../../organization/OrganizationProvider";
import { usePlatformPaymentConfig } from "../../hooks/usePlatformPaymentConfig";
import { overlayPaymentAmounts } from "../../lib/paymentConfig";
import DeveloperContacts from "../../components/license/DeveloperContacts";
import CryptoPaymentCards from "../../components/license/CryptoPaymentCards";
import {
  BankTransferSection,
  MirPaymentSection,
  VietnameseBankTransferSection,
} from "../../components/license/ManualPaymentSections";
import LoadingState from "../../components/ui/LoadingState";
import { btnAddCls } from "../../components/ui/buttonStyles";
import { fieldCls } from "../../components/ui/AppSelect";
import {
  isPurchaseCommentValid,
  PURCHASE_REQUEST_COMMENT_MIN_LENGTH,
} from "../../lib/purchaseRequest";

function formatPeriod(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "";
  return `${start} — ${end}`;
}

interface MiniAppAddonPurchaseSectionProps {
  addonActive: boolean;
  addonStatus: string | null;
  addonPeriodStart: string | null;
  addonPeriodEnd: string | null;
  canPurchase: boolean;
}

export default function MiniAppAddonPurchaseSection({
  addonActive,
  addonStatus,
  addonPeriodStart,
  addonPeriodEnd,
  canPurchase,
}: MiniAppAddonPurchaseSectionProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { organization } = useOrganization();
  const paymentConfig = usePlatformPaymentConfig(canPurchase);
  const submitRequest = useSubmitPurchaseRequest();
  const [paymentComment, setPaymentComment] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactTelegram, setContactTelegram] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isLicensed = organization?.status === "licensed";
  const statusKey =
    addonActive
      ? "hallRent.miniapp.addonOn"
      : addonStatus === "paused"
        ? "hallRent.miniapp.addonPaused"
        : addonStatus === "active"
          ? "hallRent.miniapp.addonExpired"
          : "hallRent.miniapp.addonOff";
  const periodLabel = formatPeriod(addonPeriodStart, addonPeriodEnd);
  const addonPrice = paymentConfig.config.renterMiniappAddon;
  const priceLabel = addonPrice?.amount
    ? t("hallRent.miniapp.purchase.priceMonthly", {
        amount: [addonPrice.amount, addonPrice.currency].filter(Boolean).join(" "),
      })
    : null;
  const methodsForAddon = overlayPaymentAmounts(
    paymentConfig.config,
    addonPrice?.amount,
    addonPrice?.currency
  );
  const commentLen = paymentComment.trim().length;
  const commentValid = isPurchaseCommentValid(paymentComment);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!organization) return;
    setError(null);

    try {
      await submitRequest.mutateAsync({
        organizationId: organization.id,
        paymentComment,
        contactEmail,
        contactTelegram,
        requestKind: "renter_miniapp_addon",
      });
      setPaymentComment("");
      setContactEmail("");
      setContactTelegram("");
      toast(t("hallRent.miniapp.purchase.success"), "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "request_save_failed";
      if (message === "payment_comment_too_short") {
        setError(t("license.purchase.request.commentTooShort"));
      } else if (message === "addon_requires_licensed_org") {
        setError(t("hallRent.miniapp.purchase.requiresLicensed"));
      } else {
        setError(t("hallRent.miniapp.purchase.error"));
      }
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3 space-y-3">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
          <CreditCard className="w-3.5 h-3.5 text-indigo-600" />
          {t("hallRent.miniapp.purchase.title")}
        </p>
        <p className={`text-xs leading-relaxed ${addonActive ? "text-indigo-700" : "text-slate-600"}`}>
          {t(statusKey)}
        </p>
        {periodLabel ? (
          <p className="text-[10px] text-slate-500">
            {t("hallRent.miniapp.purchase.period", { period: periodLabel })}
          </p>
        ) : null}
        {addonPeriodEnd && !addonActive ? (
          <p className="text-xs text-amber-800">
            {t("hallRent.miniapp.purchase.renewHint", { end: addonPeriodEnd })}
          </p>
        ) : null}
      </div>

      <div className="rounded-lg border border-indigo-100 bg-white px-3 py-2.5 space-y-1">
        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
          {t("hallRent.miniapp.purchase.priceLabel")}
        </p>
        {priceLabel ? (
          <p className="text-lg font-semibold text-slate-900 leading-tight">{priceLabel}</p>
        ) : (
          <p className="text-sm text-slate-600">{t("hallRent.miniapp.purchase.priceUnset")}</p>
        )}
        <p className="text-xs text-slate-500 leading-relaxed">
          {t("hallRent.miniapp.purchase.billing")}
        </p>
      </div>

      {canPurchase && !isLicensed ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
          {t("hallRent.miniapp.purchase.demoBlocked")}
        </p>
      ) : null}

      {canPurchase && isLicensed ? (
        paymentConfig.isLoading ? (
          <LoadingState label={t("license.purchase.loadingMethods")} />
        ) : (
          <>
            <p className="text-xs text-slate-500 bg-white border border-slate-200 rounded-lg px-3 py-2 leading-relaxed">
              {t("hallRent.miniapp.purchase.hint")}
            </p>
            <DeveloperContacts contacts={paymentConfig.config.contacts} embedded />
            {!!methodsForAddon.crypto?.length ||
            methodsForAddon.bankTransfer ||
            methodsForAddon.vietnameseBankTransfer ||
            methodsForAddon.mir ? (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                  {t("hallRent.miniapp.purchase.methodsTitle")}
                </p>
                {!!methodsForAddon.crypto?.length && (
                  <CryptoPaymentCards methods={methodsForAddon.crypto} />
                )}
                <BankTransferSection config={methodsForAddon.bankTransfer} />
                <VietnameseBankTransferSection config={methodsForAddon.vietnameseBankTransfer} />
                <MirPaymentSection config={methodsForAddon.mir} />
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="space-y-3">
              <label className="block space-y-1">
                <span className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                  {t("license.purchase.request.commentLabel")}
                </span>
                <textarea
                  value={paymentComment}
                  onChange={(event) => setPaymentComment(event.target.value)}
                  rows={4}
                  placeholder={t("hallRent.miniapp.purchase.commentPlaceholder")}
                  className="w-full min-h-[6rem] resize-none bg-white border border-slate-200 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-xs transition-all"
                />
                {!commentValid ? (
                  <p className="text-[10px] text-slate-400">
                    {t("license.purchase.request.commentMinHint", {
                      min: PURCHASE_REQUEST_COMMENT_MIN_LENGTH,
                      current: commentLen,
                    })}
                  </p>
                ) : null}
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                    {t("license.purchase.request.emailLabel")}
                  </span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(event) => setContactEmail(event.target.value)}
                    placeholder="name@example.com"
                    className={fieldCls}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                    {t("license.purchase.request.telegramLabel")}
                  </span>
                  <input
                    value={contactTelegram}
                    onChange={(event) => setContactTelegram(event.target.value)}
                    placeholder="@username"
                    className={fieldCls}
                  />
                </label>
              </div>

              {error ? (
                <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitRequest.isPending || !commentValid}
                className={`w-full ${btnAddCls}`}
              >
                <Send className="w-3.5 h-3.5" />
                {submitRequest.isPending
                  ? t("license.purchase.request.submitting")
                  : addonActive
                    ? t("hallRent.miniapp.purchase.submitRenew")
                    : t("hallRent.miniapp.purchase.submit")}
              </button>
            </form>
          </>
        )
      ) : null}
    </div>
  );
}
