import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Banknote, X } from "lucide-react";
import type { PaymentMethod, Subscription } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import { useI18n } from "../../hooks/useI18n";
import { usePrices } from "../../hooks/usePrices";
import {
  useFinishSubscriptionWithRefund,
  usePreviewSubscriptionRefund,
} from "../../hooks/useSubscriptionRefunds";
import {
  isRefundAmountValid,
  previewRecommendedRefund,
  type RefundCalcMode,
} from "../../lib/subscriptionRefund";
import { resolveMutationError } from "../../lib/resolveMutationError";
import {
  filterSingleVisitTariffsForSale,
  formatCurrency,
  getPriceLabel,
} from "../../lib/utils";
import {
  PAYMENT_METHODS,
  getPaymentMethodLabel,
} from "../../hooks/usePayments";
import type { ToastType } from "../../App";

interface FinishSubscriptionWithRefundDialogProps {
  subscription: Subscription | null;
  toast: (msg: string, type?: ToastType) => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export default function FinishSubscriptionWithRefundDialog({
  subscription,
  toast,
  onClose,
  onSuccess,
}: FinishSubscriptionWithRefundDialogProps) {
  const { t, formatDate } = useI18n();
  const finishWithRefund = useFinishSubscriptionWithRefund();

  const [recipientClientId, setRecipientClientId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reason, setReason] = useState("");
  const [payoutStatus, setPayoutStatus] = useState<"completed" | "pending">("completed");
  const [calcMode, setCalcMode] = useState<RefundCalcMode>("pro_rata");
  const [singleVisitTariffId, setSingleVisitTariffId] = useState<string>("");
  const [singleVisitRateInput, setSingleVisitRateInput] = useState("");
  const [amountOverride, setAmountOverride] = useState(false);
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const parsedSingleVisitRate = useMemo(() => {
    const value = parseFloat(singleVisitRateInput.replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? value : NaN;
  }, [singleVisitRateInput]);

  const previewQuery = usePreviewSubscriptionRefund(subscription?.id ?? null, {
    calcMode,
    singleVisitRate:
      calcMode === "single_visit_rate" && Number.isFinite(parsedSingleVisitRate)
        ? parsedSingleVisitRate
        : null,
    singleVisitTariffId: singleVisitTariffId || null,
  });
  const pricesQuery = usePrices();

  const preview = previewQuery.data;
  const formula = preview?.formula;
  const isLessonCount = preview?.billingModel === "lesson_count" && !formula?.requiresManualAmount;

  const subscriptionLocationId = useMemo(() => {
    if (!subscription?.priceId) return null;
    const pkg = pricesQuery.data?.find((p) => p.id === subscription.priceId);
    return pkg?.locationId ?? null;
  }, [subscription?.priceId, pricesQuery.data]);

  const singleVisitTariffs = useMemo(() => {
    if (!subscription) return [];
    return filterSingleVisitTariffsForSale(pricesQuery.data ?? [], {
      disciplineId: subscription.disciplineId ?? null,
      locationId: subscriptionLocationId,
    });
  }, [pricesQuery.data, subscription, subscriptionLocationId]);

  const canUseSingleVisitCalc =
    isLessonCount && subscription?.category === "group" && singleVisitTariffs.length > 0;

  const serverRecommendedAmount = formula?.recommendedAmount;

  useEffect(() => {
    if (!subscription || !preview) return;
    const defaultRecipient = preview.participants[0]?.clientId ?? subscription.clientId1;
    setRecipientClientId(defaultRecipient);
    setReason("");
    setCalcMode("pro_rata");
    setSingleVisitTariffId("");
    setSingleVisitRateInput("");
    setAmountOverride(false);
    setMethod("cash");
    setPayoutStatus("completed");

    if (formula?.requiresManualAmount) {
      setAmountInput("");
    } else {
      const recommended =
        formula?.recommendedAmount ??
        previewRecommendedRefund(
          formula?.salePrice ?? 0,
          preview.lessonsTotal,
          preview.lessonsLeft,
          formula?.availableAmount ?? 0
        );
      setAmountInput(recommended > 0 ? String(recommended) : "");
    }
  }, [subscription?.id, preview?.subscriptionId, formula?.requiresManualAmount, formula?.recommendedAmount]);

  useEffect(() => {
    if (amountOverride || calcMode !== "pro_rata" || !preview || !formula) return;
    if (formula.requiresManualAmount) return;
    const recommended =
      formula.recommendedAmount ??
      previewRecommendedRefund(
        formula.salePrice,
        preview.lessonsTotal,
        preview.lessonsLeft,
        formula.availableAmount
      );
    setAmountInput(recommended > 0 ? String(recommended) : "");
  }, [calcMode, preview, formula, amountOverride]);

  useEffect(() => {
    if (amountOverride || calcMode !== "single_visit_rate") return;
    if (serverRecommendedAmount == null || !Number.isFinite(serverRecommendedAmount)) return;
    setAmountInput(serverRecommendedAmount > 0 ? String(serverRecommendedAmount) : "0");
  }, [calcMode, serverRecommendedAmount, amountOverride]);

  useEffect(() => {
    if (!subscription) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !finishWithRefund.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subscription, finishWithRefund.isPending, onClose]);

  const applyProRataAmount = () => {
    if (!preview || !formula) return;
    setAmountOverride(false);
    const recommended =
      formula.recommendedAmount ??
      previewRecommendedRefund(
        formula.salePrice,
        preview.lessonsTotal,
        preview.lessonsLeft,
        formula.availableAmount
      );
    setAmountInput(recommended > 0 ? String(recommended) : "");
  };

  const handleCalcModeChange = (mode: RefundCalcMode) => {
    setCalcMode(mode);
    setAmountOverride(false);
    if (mode === "pro_rata") {
      applyProRataAmount();
    } else {
      setAmountInput("");
    }
  };

  const handleSingleVisitTariffChange = (tariffId: string) => {
    setSingleVisitTariffId(tariffId);
    if (!tariffId) return;
    const tariff = singleVisitTariffs.find((item) => item.id === tariffId);
    if (tariff) setSingleVisitRateInput(String(tariff.price));
  };

  const parsedAmount = useMemo(() => {
    const value = parseFloat(amountInput.replace(",", "."));
    return Number.isFinite(value) ? value : NaN;
  }, [amountInput]);

  const availableAmount = formula?.availableAmount ?? 0;

  const canSubmit =
    subscription &&
    preview &&
    recipientClientId &&
    reason.trim().length > 0 &&
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    isRefundAmountValid(parsedAmount, availableAmount) &&
    (calcMode !== "single_visit_rate" || Number.isFinite(parsedSingleVisitRate)) &&
    (!canUseSingleVisitCalc || calcMode !== "single_visit_rate" || previewQuery.isSuccess);

  const handleSubmit = async () => {
    if (!subscription || !canSubmit) return;

    const res = await finishWithRefund.mutateAsync({
      subscriptionId: subscription.id,
      recipientClientId,
      amount: parsedAmount,
      method,
      reason: reason.trim(),
      status: payoutStatus,
      idempotencyKey,
      calcMode: canUseSingleVisitCalc ? calcMode : "pro_rata",
      singleVisitRate:
        canUseSingleVisitCalc && calcMode === "single_visit_rate" ? parsedSingleVisitRate : null,
      singleVisitTariffId:
        canUseSingleVisitCalc && calcMode === "single_visit_rate" && singleVisitTariffId
          ? singleVisitTariffId
          : null,
      amountOverride,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "subscriptions.refund.error.finishFailed", t), "error");
      return;
    }

    toast(
      res.status === "pending"
        ? t("subscriptions.refund.successPending", {
            amount: formatCurrency(res.amount),
            id: res.refundId?.slice(0, 8) ?? "—",
          })
        : t("subscriptions.refund.success", {
            amount: formatCurrency(res.amount),
            id: res.refundId?.slice(0, 8) ?? "—",
          }),
      "success"
    );
    onSuccess();
    onClose();
  };

  if (!subscription) return null;

  return (
    <AnimatePresence>
      {subscription ? (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-ink-950/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !finishWithRefund.isPending && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="refund-dialog-title"
            className="bg-white rounded-xl shadow-xl border border-ink-200 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-4 py-3 border-b border-ink-100">
              <div className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-gold-700" />
                <h2 id="refund-dialog-title" className="font-sans text-sm font-semibold text-ink-800">
                  {t("subscriptions.refund.title")}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={finishWithRefund.isPending}
                className="p-1 rounded-lg text-ink-400 hover:text-ink-700 hover:bg-ink-50 cursor-pointer disabled:opacity-50"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-xs text-ink-500">{t("subscriptions.refund.summary")}</p>

              {previewQuery.isLoading ? (
                <LoadingState label={t("subscriptions.refund.error.previewFailed")} />
              ) : null}
              {previewQuery.isError ? <QueryErrorState error={previewQuery.error} /> : null}

              {preview && formula ? (
                <>
                  <div className="rounded-lg border border-ink-100 bg-ink-50 p-3 space-y-2 text-sm">
                    {!formula.requiresManualAmount ? (
                      <p className="text-ink-700">
                        {t("subscriptions.refund.lessonsLeft", {
                          left: preview.lessonsLeft,
                          total: preview.lessonsTotal,
                        })}
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-ink-400">{t("subscriptions.refund.salePrice")}</span>
                        <p className="font-semibold text-ink-800">{formatCurrency(formula.salePrice)}</p>
                      </div>
                      <div>
                        <span className="text-ink-400">{t("subscriptions.refund.received")}</span>
                        <p className="font-semibold text-ink-800">{formatCurrency(formula.receivedTotal)}</p>
                      </div>
                      <div>
                        <span className="text-ink-400">{t("subscriptions.refund.priorRefunds")}</span>
                        <p className="font-semibold text-ink-800">{formatCurrency(formula.priorRefunds)}</p>
                      </div>
                      {(formula.pendingRefunds ?? 0) > 0 ? (
                        <div>
                          <span className="text-ink-400">{t("subscriptions.refund.pendingRefunds")}</span>
                          <p className="font-semibold text-amber-700">
                            {formatCurrency(formula.pendingRefunds ?? 0)}
                          </p>
                        </div>
                      ) : null}
                      <div>
                        <span className="text-ink-400">{t("subscriptions.refund.available")}</span>
                        <p className="font-semibold text-gold-700">
                          {formatCurrency(formula.availableAmount)}
                        </p>
                      </div>
                    </div>
                    {!formula.requiresManualAmount && formula.formula && calcMode === "pro_rata" ? (
                      <p className="text-[11px] text-ink-500">
                        {t("subscriptions.refund.formula", { formula: formula.formula })}
                      </p>
                    ) : null}
                    {!formula.requiresManualAmount &&
                    formula.perLessonPrice != null &&
                    calcMode === "pro_rata" ? (
                      <p className="text-[11px] text-ink-500">
                        {t("subscriptions.refund.perLesson", {
                          amount: formatCurrency(formula.perLessonPrice),
                        })}
                      </p>
                    ) : null}
                    {formula.requiresManualAmount ? (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                        {t("subscriptions.refund.manualRequired")}
                        {formula.activationDate && formula.expiresAt ? (
                          <>
                            {" "}
                            {t("subscriptions.refund.monthlyHint", {
                              from: formatDate(formula.activationDate),
                              to: formatDate(formula.expiresAt),
                            })}
                          </>
                        ) : null}
                      </p>
                    ) : null}
                  </div>

                  {canUseSingleVisitCalc ? (
                    <div className="space-y-3">
                      <AppSelect
                        label={t("subscriptions.refund.calcMode")}
                        value={calcMode}
                        onChange={(e) => handleCalcModeChange(e.target.value as RefundCalcMode)}
                      >
                        <option value="pro_rata">{t("subscriptions.refund.calcMode.proRata")}</option>
                        <option value="single_visit_rate">
                          {t("subscriptions.refund.calcMode.singleVisit")}
                        </option>
                      </AppSelect>

                      {calcMode === "single_visit_rate" ? (
                        <div className="rounded-lg border border-gold-100 bg-gold-50/40 p-3 space-y-3">
                          <p className="text-[11px] text-ink-600 leading-relaxed">
                            {t("subscriptions.refund.singleVisit.hint")}
                          </p>
                          <AppSelect
                            label={t("subscriptions.refund.singleVisit.tariff")}
                            value={singleVisitTariffId}
                            onChange={(e) => handleSingleVisitTariffChange(e.target.value)}
                          >
                            <option value="">{t("subscriptions.refund.singleVisit.custom")}</option>
                            {singleVisitTariffs.map((tariff) => (
                              <option key={tariff.id} value={tariff.id ?? ""}>
                                {getPriceLabel(tariff)} — {formatCurrency(tariff.price)}
                              </option>
                            ))}
                          </AppSelect>
                          <div>
                            <label htmlFor="single-visit-rate-input" className={labelCls}>
                              {t("subscriptions.refund.singleVisit.rate")}
                            </label>
                            <input
                              id="single-visit-rate-input"
                              type="number"
                              min={0}
                              step="0.01"
                              value={singleVisitRateInput}
                              onChange={(e) => {
                                setAmountOverride(false);
                                setSingleVisitTariffId("");
                                setSingleVisitRateInput(e.target.value);
                              }}
                              className={fieldCls}
                            />
                          </div>
                          {previewQuery.isFetching ? (
                            <p className="text-[11px] text-ink-500">{t("common.loading.data")}</p>
                          ) : formula?.calcMode === "single_visit_rate" &&
                            Number.isFinite(parsedSingleVisitRate) ? (
                            <div className="text-[11px] text-ink-600 space-y-1">
                              <p>
                                {t("subscriptions.refund.singleVisit.used", {
                                  count: formula.lessonsUsed ?? 0,
                                  rate: formatCurrency(parsedSingleVisitRate),
                                  retained: formatCurrency(formula.retainedAmount ?? 0),
                                })}
                              </p>
                              {formula.formula ? (
                                <p className="text-ink-500">{formula.formula}</p>
                              ) : null}
                              <p className="font-semibold text-gold-800">
                                {t("subscriptions.refund.singleVisit.result", {
                                  amount: formatCurrency(formula.recommendedAmount ?? 0),
                                })}
                              </p>
                            </div>
                          ) : (
                            <p className="text-[11px] text-amber-700">
                              {t("subscriptions.refund.singleVisit.rateRequired")}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <AppSelect
                    label={t("subscriptions.refund.recipient")}
                    value={recipientClientId}
                    onChange={(e) => setRecipientClientId(e.target.value)}
                  >
                    {preview.participants.map((p) => (
                      <option key={p.clientId} value={p.clientId}>
                        {p.displayName}
                      </option>
                    ))}
                  </AppSelect>

                  <div>
                    <label className={labelCls}>{t("subscriptions.refund.amount")}</label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={amountInput}
                      onChange={(e) => {
                        setAmountOverride(true);
                        setAmountInput(e.target.value);
                      }}
                      className={fieldCls}
                    />
                    {!formula.requiresManualAmount &&
                    formula.recommendedAmount != null &&
                    (calcMode === "pro_rata" || calcMode === "single_visit_rate") ? (
                      <p className="text-[10px] text-ink-500 mt-1">
                        {t("subscriptions.refund.recommended")}:{" "}
                        {formatCurrency(formula.recommendedAmount)}
                      </p>
                    ) : null}
                  </div>

                  <AppSelect
                    label={t("subscriptions.refund.method")}
                    value={method}
                    onChange={(e) => setMethod(e.target.value as PaymentMethod)}
                  >
                    {PAYMENT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {getPaymentMethodLabel(m, t)}
                      </option>
                    ))}
                  </AppSelect>

                  <AppSelect
                    label={t("subscriptions.refund.payoutStatus")}
                    value={payoutStatus}
                    onChange={(e) => setPayoutStatus(e.target.value as "completed" | "pending")}
                  >
                    <option value="completed">{t("subscriptions.refund.payoutCompleted")}</option>
                    <option value="pending">{t("subscriptions.refund.payoutPending")}</option>
                  </AppSelect>

                  <div>
                    <label className={labelCls}>{t("subscriptions.refund.reason")}</label>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                      placeholder={
                        calcMode === "single_visit_rate"
                          ? t("subscriptions.refund.reasonPlaceholderSingleVisit")
                          : t("subscriptions.refund.reasonPlaceholder")
                      }
                      className={`${fieldCls} resize-y min-h-[4.5rem]`}
                    />
                  </div>
                </>
              ) : null}
            </div>

            <div className="px-4 py-3 border-t border-ink-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={finishWithRefund.isPending}
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-ink-600 hover:bg-ink-50 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || finishWithRefund.isPending || previewQuery.isLoading}
                className={btnAddCls}
              >
                {finishWithRefund.isPending
                  ? t("subscriptions.refund.submitPending")
                  : t("subscriptions.refund.submit")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
