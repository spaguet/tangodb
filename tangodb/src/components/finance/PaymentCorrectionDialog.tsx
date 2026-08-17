import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import {
  PAYMENT_CORRECTION_REASONS,
  formatOperationNumber,
  type PaymentCorrectionReasonCode,
  type PaymentWithCorrectionMeta,
} from "../../lib/paymentCorrection";
import {
  useCorrectPayment,
  useStornoPayment,
} from "../../hooks/usePaymentCorrections";
import {
  PAYMENT_METHODS,
  getPaymentMethodLabel,
  paymentSourceLabel,
} from "../../hooks/usePayments";
import { useI18n } from "../../hooks/useI18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import type { PaymentMethod } from "../../types";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

type CorrectionMode = "void" | "correct";

interface PaymentCorrectionDialogProps {
  payment: PaymentWithCorrectionMeta | null;
  open: boolean;
  onClose: () => void;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
}

export default function PaymentCorrectionDialog({
  payment,
  open,
  onClose,
  toast,
}: PaymentCorrectionDialogProps) {
  const { t, formatDateTime } = useI18n();
  const stornoPayment = useStornoPayment();
  const correctPayment = useCorrectPayment();

  const [mode, setMode] = useState<CorrectionMode>("void");
  const [reasonCode, setReasonCode] = useState<PaymentCorrectionReasonCode>("duplicate");
  const [reasonComment, setReasonComment] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newMethod, setNewMethod] = useState<PaymentMethod>("cash");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [savedOperationNumber, setSavedOperationNumber] = useState<number | null>(null);

  const isPending = stornoPayment.isPending || correctPayment.isPending;
  const isSaved = savedOperationNumber != null;

  const canCorrect = useMemo(() => {
    if (!payment) return false;
    return (
      payment.operationKind !== "storno" &&
      payment.correctionStatus !== "voided" &&
      payment.correctionStatus !== "replaced" &&
      (payment.remainingAmount ?? payment.amount) > 0
    );
  }, [payment]);

  const handleSubmit = async () => {
    if (!payment || !canCorrect) return;

    if (mode === "void") {
      const res = await stornoPayment.mutateAsync({
        paymentId: payment.id,
        reasonCode,
        reasonComment: reasonComment.trim() || undefined,
        idempotencyKey,
      });
      if (!res.success) {
        toast(resolveMutationError(res.error, "corrections.error.stornoFailed", t), "error");
        return;
      }
      setSavedOperationNumber(res.operationNumber ?? null);
      toast(
        res.alreadyApplied
          ? t("corrections.payment.alreadyApplied")
          : t("corrections.payment.voidSuccess", {
              op: formatOperationNumber(res.operationNumber),
            }),
        res.alreadyApplied ? "info" : "success"
      );
      return;
    }

    const amount = Number(newAmount);
    if (!amount || amount <= 0) {
      toast(t("corrections.payment.amountInvalid"), "error");
      return;
    }

    const res = await correctPayment.mutateAsync({
      paymentId: payment.id,
      newAmount: amount,
      newMethod,
      reasonCode,
      reasonComment: reasonComment.trim() || undefined,
      idempotencyKey,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "corrections.error.correctFailed", t), "error");
      return;
    }
    setSavedOperationNumber(res.operationNumber ?? null);
    toast(
      res.alreadyApplied
        ? t("corrections.payment.alreadyApplied")
        : t("corrections.payment.correctSuccess", {
            op: formatOperationNumber(res.operationNumber),
          }),
      res.alreadyApplied ? "info" : "success"
    );
  };

  const handleClose = () => {
    setSavedOperationNumber(null);
    setReasonComment("");
    setNewAmount("");
    onClose();
  };

  if (!payment) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-ink-950/40" onClick={handleClose} />
          <motion.div
            className="relative w-full sm:max-w-lg bg-white rounded-t-xl sm:rounded-xl shadow-xl max-h-[90vh] overflow-y-auto"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
          >
            <div className="flex items-start justify-between gap-3 p-4 border-b border-ink-100">
              <div>
                <p className="text-base font-semibold text-ink-900">{t("corrections.payment.title")}</p>
                <p className="text-xs text-ink-500 mt-1">{t("corrections.payment.subtitle")}</p>
              </div>
              <button type="button" onClick={handleClose} className="p-1 text-ink-400 hover:text-ink-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="rounded-xl bg-ink-50 p-3 space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <span className="text-ink-500">{t("corrections.payment.original")}</span>
                  <span className="font-semibold text-ink-800">{formatCurrency(payment.amount)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-500">{t("corrections.payment.client")}</span>
                  <span className="text-ink-800 truncate">{payment.clientDisplay}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-500">{t("corrections.payment.method")}</span>
                  <span className="text-ink-800">{getPaymentMethodLabel(payment.method, t)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-500">{t("corrections.payment.source")}</span>
                  <span className="text-ink-800">{paymentSourceLabel(payment, t)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span className="text-ink-500">{t("corrections.payment.date")}</span>
                  <span className="text-ink-800">
                    {formatDateTime(payment.createdAt, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {payment.operationNumber != null && (
                  <div className="flex justify-between gap-3">
                    <span className="text-ink-500">{t("corrections.payment.operationNumber")}</span>
                    <span className="text-ink-800">{formatOperationNumber(payment.operationNumber)}</span>
                  </div>
                )}
              </div>

              {!canCorrect ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                  <span>{t("corrections.payment.notCorrectable")}</span>
                </div>
              ) : (
                <>
                  <AppSelect
                    label={t("corrections.payment.mode")}
                    value={mode}
                    onChange={(e) => setMode(e.target.value as CorrectionMode)}
                  >
                    <option value="void">{t("corrections.payment.modeVoid")}</option>
                    <option value="correct">{t("corrections.payment.modeCorrect")}</option>
                  </AppSelect>

                  <AppSelect
                    label={t("corrections.payment.reason")}
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value as PaymentCorrectionReasonCode)}
                  >
                    {PAYMENT_CORRECTION_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {t(r.labelKey as Parameters<typeof t>[0])}
                      </option>
                    ))}
                  </AppSelect>

                  <div>
                    <label className={labelCls}>{t("corrections.payment.comment")}</label>
                    <textarea
                      value={reasonComment}
                      onChange={(e) => setReasonComment(e.target.value)}
                      rows={2}
                      className={`${fieldCls} resize-y min-h-[3rem]`}
                      placeholder={t("corrections.payment.commentPlaceholder")}
                    />
                  </div>

                  {mode === "correct" && (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>{t("corrections.payment.newAmount")}</label>
                        <input
                          type="number"
                          min={1}
                          value={newAmount}
                          onChange={(e) => setNewAmount(e.target.value)}
                          className={fieldCls}
                        />
                      </div>
                      <AppSelect
                        label={t("corrections.payment.newMethod")}
                        value={newMethod}
                        onChange={(e) => setNewMethod(e.target.value as PaymentMethod)}
                      >
                        {PAYMENT_METHODS.map((m) => (
                          <option key={m} value={m}>
                            {getPaymentMethodLabel(m, t)}
                          </option>
                        ))}
                      </AppSelect>
                    </div>
                  )}
                </>
              )}

              {isSaved && savedOperationNumber != null && (
                <p className="text-sm text-gold-700 font-medium">
                  {t("corrections.payment.saved", { op: formatOperationNumber(savedOperationNumber) })}
                </p>
              )}
            </div>

            <div className="p-4 border-t border-ink-100 flex gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="flex-1 py-2.5 rounded-xl border border-ink-200 text-sm font-medium text-ink-600"
              >
                {isSaved ? t("common.close") : t("common.cancel")}
              </button>
              {canCorrect && !isSaved && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => void handleSubmit()}
                  className="flex-1 py-2.5 rounded-xl bg-gold-700 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {isPending ? t("common.saving") : t("corrections.payment.confirm")}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
