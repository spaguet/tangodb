import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Banknote, X } from "lucide-react";
import type { Subscription } from "../../types";
import type { PaymentMethod } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import { useI18n } from "../../hooks/useI18n";
import {
  useFinishSubscriptionWithRefund,
  usePreviewSubscriptionRefund,
} from "../../hooks/useSubscriptionRefunds";
import {
  isRefundAmountValid,
  previewRecommendedRefund,
} from "../../lib/subscriptionRefund";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
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

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function FinishSubscriptionWithRefundDialog({
  subscription,
  toast,
  onClose,
  onSuccess,
}: FinishSubscriptionWithRefundDialogProps) {
  const { t, formatDate } = useI18n();
  const finishWithRefund = useFinishSubscriptionWithRefund();
  const previewQuery = usePreviewSubscriptionRefund(subscription?.id ?? null);

  const [recipientClientId, setRecipientClientId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reason, setReason] = useState("");
  const [payoutStatus, setPayoutStatus] = useState<"completed" | "pending">("completed");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const preview = previewQuery.data;
  const formula = preview?.formula;

  useEffect(() => {
    if (!subscription || !preview) return;
    const defaultRecipient = preview.participants[0]?.clientId ?? subscription.clientId1;
    setRecipientClientId(defaultRecipient);
    setReason("");

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
    setMethod("cash");
    setPayoutStatus("completed");
  }, [subscription, preview, formula]);

  useEffect(() => {
    if (!subscription) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !finishWithRefund.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subscription, finishWithRefund.isPending, onClose]);

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
    isRefundAmountValid(parsedAmount, availableAmount);

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
          className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => !finishWithRefund.isPending && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="refund-dialog-title"
            className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto"
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.96, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Banknote className="w-4 h-4 text-emerald-600" />
                <h2 id="refund-dialog-title" className="font-sans text-sm font-semibold text-slate-800">
                  {t("subscriptions.refund.title")}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={finishWithRefund.isPending}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-xs text-slate-500">{t("subscriptions.refund.summary")}</p>

              {previewQuery.isLoading ? (
                <LoadingState label={t("subscriptions.refund.error.previewFailed")} />
              ) : null}
              {previewQuery.isError ? <QueryErrorState error={previewQuery.error} /> : null}

              {preview && formula ? (
                <>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2 text-sm">
                    {!formula.requiresManualAmount ? (
                      <p className="text-slate-700">
                        {t("subscriptions.refund.lessonsLeft", {
                          left: preview.lessonsLeft,
                          total: preview.lessonsTotal,
                        })}
                      </p>
                    ) : null}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-400">{t("subscriptions.refund.salePrice")}</span>
                        <p className="font-semibold text-slate-800">{formatCurrency(formula.salePrice)}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">{t("subscriptions.refund.received")}</span>
                        <p className="font-semibold text-slate-800">{formatCurrency(formula.receivedTotal)}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">{t("subscriptions.refund.priorRefunds")}</span>
                        <p className="font-semibold text-slate-800">{formatCurrency(formula.priorRefunds)}</p>
                      </div>
                      {(formula.pendingRefunds ?? 0) > 0 ? (
                        <div>
                          <span className="text-slate-400">{t("subscriptions.refund.pendingRefunds")}</span>
                          <p className="font-semibold text-amber-700">{formatCurrency(formula.pendingRefunds ?? 0)}</p>
                        </div>
                      ) : null}
                      <div>
                        <span className="text-slate-400">{t("subscriptions.refund.available")}</span>
                        <p className="font-semibold text-emerald-700">{formatCurrency(formula.availableAmount)}</p>
                      </div>
                    </div>
                    {!formula.requiresManualAmount && formula.formula ? (
                      <p className="text-[11px] text-slate-500">
                        {t("subscriptions.refund.formula", { formula: formula.formula })}
                      </p>
                    ) : null}
                    {!formula.requiresManualAmount && formula.perLessonPrice != null ? (
                      <p className="text-[11px] text-slate-500">
                        {t("subscriptions.refund.perLesson", {
                          amount: formatCurrency(formula.perLessonPrice),
                        })}
                      </p>
                    ) : null}
                    {formula.requiresManualAmount ? (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
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
                      onChange={(e) => setAmountInput(e.target.value)}
                      className={fieldCls}
                    />
                    {!formula.requiresManualAmount && formula.recommendedAmount != null ? (
                      <p className="text-[10px] text-slate-400 mt-1">
                        {t("subscriptions.refund.recommended")}: {formatCurrency(formula.recommendedAmount)}
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
                      placeholder={t("subscriptions.refund.reasonPlaceholder")}
                      className={`${fieldCls} resize-y min-h-[4.5rem]`}
                    />
                  </div>
                </>
              ) : null}
            </div>

            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={finishWithRefund.isPending}
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-600 hover:bg-slate-50 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || finishWithRefund.isPending || previewQuery.isLoading}
                className="px-3 py-2 text-xs font-semibold uppercase tracking-wider bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 cursor-pointer disabled:opacity-50"
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
