import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, X } from "lucide-react";
import type { Subscription } from "../../types";
import type { PaymentMethod } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import LoadingState from "../ui/LoadingState";
import QueryErrorState from "../ui/QueryErrorState";
import { useI18n } from "../../hooks/useI18n";
import {
  useCreateSubscriptionRefund,
  usePreviewSubscriptionRefund,
} from "../../hooks/useSubscriptionRefunds";
import {
  computeLessonsFromRefundAmount,
  isPartialRefundAmountValid,
} from "../../lib/subscriptionRefund";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import { PAYMENT_METHODS, getPaymentMethodLabel } from "../../hooks/usePayments";
import type { ToastType } from "../../App";

interface PartialSubscriptionRefundDialogProps {
  subscription: Subscription | null;
  toast: (msg: string, type?: ToastType) => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const checkboxCls = "rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";

export default function PartialSubscriptionRefundDialog({
  subscription,
  toast,
  onClose,
  onSuccess,
}: PartialSubscriptionRefundDialogProps) {
  const { t } = useI18n();
  const createRefund = useCreateSubscriptionRefund();
  const previewQuery = usePreviewSubscriptionRefund(subscription?.id ?? null);

  const [recipientClientId, setRecipientClientId] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [reason, setReason] = useState("");
  const [payoutStatus, setPayoutStatus] = useState<"completed" | "pending">("completed");
  const [deductLessons, setDeductLessons] = useState(false);
  const [lessonsInput, setLessonsInput] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const preview = previewQuery.data;
  const formula = preview?.formula;

  useEffect(() => {
    if (!subscription || !preview) return;
    setRecipientClientId(preview.participants[0]?.clientId ?? subscription.clientId1);
    setAmountInput("");
    setReason("");
    setMethod("cash");
    setPayoutStatus("completed");
    setDeductLessons(false);
    setLessonsInput("");
  }, [subscription, preview]);

  useEffect(() => {
    if (!subscription) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !createRefund.isPending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [subscription, createRefund.isPending, onClose]);

  const parsedAmount = useMemo(() => {
    const value = parseFloat(amountInput.replace(",", "."));
    return Number.isFinite(value) ? value : NaN;
  }, [amountInput]);

  const availableAmount = formula?.availableAmount ?? 0;

  const suggestedLessons = useMemo(() => {
    if (!formula?.perLessonPrice || !preview) return 0;
    return computeLessonsFromRefundAmount(parsedAmount, formula.perLessonPrice, preview.lessonsLeft);
  }, [formula?.perLessonPrice, parsedAmount, preview]);

  useEffect(() => {
    if (deductLessons && suggestedLessons > 0) {
      setLessonsInput(String(suggestedLessons));
    }
  }, [deductLessons, suggestedLessons]);

  const parsedLessons = useMemo(() => {
    const value = parseInt(lessonsInput, 10);
    return Number.isFinite(value) ? value : NaN;
  }, [lessonsInput]);

  const lessonsValid =
    !deductLessons ||
    (Number.isFinite(parsedLessons) &&
      parsedLessons >= 0 &&
      parsedLessons <= (preview?.lessonsLeft ?? 0));

  const canSubmit =
    subscription &&
    preview &&
    recipientClientId &&
    reason.trim().length > 0 &&
    Number.isFinite(parsedAmount) &&
    isPartialRefundAmountValid(parsedAmount, availableAmount) &&
    lessonsValid;

  const handleSubmit = async () => {
    if (!subscription || !canSubmit) return;

    const res = await createRefund.mutateAsync({
      subscriptionId: subscription.id,
      recipientClientId,
      amount: parsedAmount,
      method,
      reason: reason.trim(),
      status: payoutStatus,
      lessonsToDeduct: deductLessons ? parsedLessons : null,
      idempotencyKey,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "subscriptions.refund.error.partialFailed", t), "error");
      return;
    }

    toast(
      res.status === "pending"
        ? t("subscriptions.refund.partialSuccessPending", {
            amount: formatCurrency(res.amount),
            id: res.refundId?.slice(0, 8) ?? "—",
          })
        : t("subscriptions.refund.partialSuccess", {
            amount: formatCurrency(res.amount),
            id: res.refundId?.slice(0, 8) ?? "—",
            lessons: res.lessonsDeducted,
          }),
      "success"
    );
    onSuccess();
    onClose();
  };

  if (!subscription) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-900/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={() => !createRefund.isPending && onClose()}
      >
        <motion.div
          role="dialog"
          aria-modal="true"
          className="bg-white rounded-xl shadow-xl border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto"
          initial={{ scale: 0.96, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.96, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between px-4 py-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Coins className="w-4 h-4 text-indigo-600" />
              <h2 className="font-sans text-sm font-semibold text-slate-800">
                {t("subscriptions.refund.partialTitle")}
              </h2>
            </div>
            <button type="button" onClick={onClose} disabled={createRefund.isPending} className="p-1 rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            <p className="text-xs text-slate-500">{t("subscriptions.refund.partialSummary")}</p>

            {previewQuery.isLoading ? <LoadingState label={t("subscriptions.refund.error.previewFailed")} /> : null}
            {previewQuery.isError ? <QueryErrorState error={previewQuery.error} /> : null}

            {preview && formula ? (
              <>
                <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400">{t("subscriptions.refund.available")}</span>
                    <p className="font-semibold text-indigo-700">{formatCurrency(formula.availableAmount)}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">{t("subscriptions.refund.lessonsLeft")}</span>
                    <p className="font-semibold text-slate-800">
                      {t("subscriptions.refund.lessonsLeft", {
                        left: preview.lessonsLeft,
                        total: preview.lessonsTotal,
                      })}
                    </p>
                  </div>
                  {(formula.pendingRefunds ?? 0) > 0 ? (
                    <div className="col-span-2">
                      <span className="text-slate-400">{t("subscriptions.refund.pendingRefunds")}</span>
                      <p className="font-semibold text-amber-700">{formatCurrency(formula.pendingRefunds ?? 0)}</p>
                    </div>
                  ) : null}
                </div>

                <AppSelect label={t("subscriptions.refund.recipient")} value={recipientClientId} onChange={(e) => setRecipientClientId(e.target.value)}>
                  {preview.participants.map((p) => (
                    <option key={p.clientId} value={p.clientId}>{p.displayName}</option>
                  ))}
                </AppSelect>

                <div>
                  <label className={labelCls}>{t("subscriptions.refund.amount")}</label>
                  <input type="number" min={0} step="0.01" value={amountInput} onChange={(e) => setAmountInput(e.target.value)} className={fieldCls} />
                </div>

                {!formula.requiresManualAmount && formula.perLessonPrice != null ? (
                  <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
                    <input type="checkbox" checked={deductLessons} onChange={(e) => setDeductLessons(e.target.checked)} className={`${checkboxCls} mt-0.5`} />
                    <span>{t("subscriptions.refund.deductLessons")}</span>
                  </label>
                ) : null}

                {deductLessons ? (
                  <div>
                    <label className={labelCls}>{t("subscriptions.refund.lessonsToDeduct")}</label>
                    <input type="number" min={0} max={preview.lessonsLeft} value={lessonsInput} onChange={(e) => setLessonsInput(e.target.value)} className={fieldCls} />
                    {suggestedLessons > 0 ? (
                      <p className="text-[10px] text-slate-400 mt-1">
                        {t("subscriptions.refund.lessonsSuggested", { count: suggestedLessons })}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                <AppSelect label={t("subscriptions.refund.method")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>{getPaymentMethodLabel(m, t)}</option>
                  ))}
                </AppSelect>

                <AppSelect label={t("subscriptions.refund.payoutStatus")} value={payoutStatus} onChange={(e) => setPayoutStatus(e.target.value as "completed" | "pending")}>
                  <option value="completed">{t("subscriptions.refund.payoutCompleted")}</option>
                  <option value="pending">{t("subscriptions.refund.payoutPending")}</option>
                </AppSelect>

                <div>
                  <label className={labelCls}>{t("subscriptions.refund.reason")}</label>
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("subscriptions.refund.reasonPlaceholder")} className={`${fieldCls} resize-y min-h-[4.5rem]`} />
                </div>
              </>
            ) : null}
          </div>

          <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={createRefund.isPending} className="px-3 py-2 text-xs font-semibold uppercase text-slate-600 hover:bg-slate-50 rounded-lg cursor-pointer">
              {t("common.cancel")}
            </button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit || createRefund.isPending || previewQuery.isLoading} className="px-3 py-2 text-xs font-semibold uppercase bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 cursor-pointer disabled:opacity-50">
              {createRefund.isPending ? t("subscriptions.refund.submitPending") : t("subscriptions.refund.partialSubmit")}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
