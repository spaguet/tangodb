import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import ConfirmDialog from "../ui/ConfirmDialog";
import {
  PAYMENT_CORRECTION_REASONS,
  formatOperationNumber,
  type PaymentCorrectionReasonCode,
  type PaymentWithCorrectionMeta,
} from "../../lib/paymentCorrection";
import {
  useCorrectPayment,
  useStornoPayment,
  useUpdatePaymentMethod,
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

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

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
  const updatePaymentMethod = useUpdatePaymentMethod();

  const [mode, setMode] = useState<CorrectionMode>("correct");
  const [reasonCode, setReasonCode] = useState<PaymentCorrectionReasonCode>("wrong_method");
  const [reasonComment, setReasonComment] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [newMethod, setNewMethod] = useState<PaymentMethod>("cash");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [savedOperationNumber, setSavedOperationNumber] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!open || !payment) return;
    setMode("correct");
    setReasonCode("wrong_method");
    setReasonComment("");
    setNewAmount(String(payment.amount));
    setNewMethod(payment.method);
    setSavedOperationNumber(null);
    setConfirmOpen(false);
    setIdempotencyKey(crypto.randomUUID());
  }, [open, payment?.id, payment?.amount, payment?.method]);

  const isPending =
    stornoPayment.isPending || correctPayment.isPending || updatePaymentMethod.isPending;
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

  const parsedAmount = Number(newAmount);

  const isMethodOnlyChange = useMemo(() => {
    if (!payment || mode !== "correct") return false;
    return parsedAmount > 0 && parsedAmount === payment.amount && newMethod !== payment.method;
  }, [payment, mode, parsedAmount, newMethod]);

  const validateForm = (): string | null => {
    if (!payment || !canCorrect) return t("corrections.payment.notCorrectable");

    if (mode === "void") return null;

    if (!parsedAmount || parsedAmount <= 0) return t("corrections.payment.amountInvalid");

    const maxAmount = payment.remainingAmount ?? payment.amount;
    if (parsedAmount > maxAmount) return t("corrections.payment.exceedsRemaining");

    if (parsedAmount === payment.amount && newMethod === payment.method) {
      return t("corrections.payment.nothingChanged");
    }

    return null;
  };

  const confirmLines = useMemo(() => {
    if (!payment) return [];

    if (mode === "void") {
      const voidAmount = payment.remainingAmount ?? payment.amount;
      return [
        t("corrections.payment.confirmLineClient", { client: payment.clientDisplay }),
        t("corrections.payment.confirmLineVoid", { amount: formatCurrency(voidAmount) }),
        t("corrections.payment.confirmLineRefundCreated", { amount: formatCurrency(voidAmount) }),
      ];
    }

    if (isMethodOnlyChange) {
      return [
        t("corrections.payment.confirmLineClient", { client: payment.clientDisplay }),
        t("corrections.payment.confirmLineMethodChange", {
          from: getPaymentMethodLabel(payment.method, t),
          to: getPaymentMethodLabel(newMethod, t),
        }),
        t("corrections.payment.confirmLineNoRefund"),
      ];
    }

    return [
      t("corrections.payment.confirmLineClient", { client: payment.clientDisplay }),
      t("corrections.payment.confirmLineVoid", { amount: formatCurrency(parsedAmount) }),
      t("corrections.payment.confirmLineRefundCreated", { amount: formatCurrency(parsedAmount) }),
      t("corrections.payment.confirmLineNewPayment", {
        amount: formatCurrency(parsedAmount),
        method: getPaymentMethodLabel(newMethod, t),
      }),
    ];
  }, [payment, mode, isMethodOnlyChange, parsedAmount, newMethod, t]);

  const confirmDescription = (
    <ul className="list-disc pl-4 space-y-1 text-left">
      {confirmLines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ul>
  );

  const executeSubmit = async () => {
    if (!payment || !canCorrect) return;
    setConfirmOpen(false);

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

    if (isMethodOnlyChange) {
      const res = await updatePaymentMethod.mutateAsync({
        paymentId: payment.id,
        newMethod,
        reasonCode,
        reasonComment: reasonComment.trim() || undefined,
        idempotencyKey,
      });
      if (!res.success) {
        toast(resolveMutationError(res.error, "corrections.error.methodUpdateFailed", t), "error");
        return;
      }
      setSavedOperationNumber(res.operationNumber ?? null);
      toast(
        res.alreadyApplied
          ? t("corrections.payment.alreadyApplied")
          : t("corrections.payment.methodUpdateSuccess", {
              op: formatOperationNumber(res.operationNumber),
            }),
        res.alreadyApplied ? "info" : "success"
      );
      return;
    }

    const res = await correctPayment.mutateAsync({
      paymentId: payment.id,
      newAmount: parsedAmount,
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

  const handlePrepareSubmit = () => {
    const validationError = validateForm();
    if (validationError) {
      toast(validationError, "error");
      return;
    }
    setConfirmOpen(true);
  };

  const handleClose = () => {
    setSavedOperationNumber(null);
    setReasonComment("");
    setNewAmount("");
    setConfirmOpen(false);
    onClose();
  };

  if (!payment) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-slate-900/40" onClick={handleClose} />
            <motion.div
              className="relative w-full sm:max-w-lg bg-white rounded-t-xl sm:rounded-xl shadow-xl max-h-[90vh] overflow-y-auto"
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
            >
              <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-100">
                <div>
                  <p className="text-base font-semibold text-slate-900">{t("corrections.payment.title")}</p>
                  <p className="text-xs text-slate-500 mt-1">{t("corrections.payment.subtitle")}</p>
                </div>
                <button type="button" onClick={handleClose} className="p-1 text-slate-400 hover:text-slate-600">
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 space-y-4">
                <div className="rounded-xl bg-slate-50 p-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t("corrections.payment.original")}</span>
                    <span className="font-semibold text-slate-800">{formatCurrency(payment.amount)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t("corrections.payment.client")}</span>
                    <span className="text-slate-800 truncate">{payment.clientDisplay}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t("corrections.payment.method")}</span>
                    <span className="text-slate-800">{getPaymentMethodLabel(payment.method, t)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t("corrections.payment.source")}</span>
                    <span className="text-slate-800">{paymentSourceLabel(payment, t)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">{t("corrections.payment.date")}</span>
                    <span className="text-slate-800">
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
                      <span className="text-slate-500">{t("corrections.payment.operationNumber")}</span>
                      <span className="text-slate-800">{formatOperationNumber(payment.operationNumber)}</span>
                    </div>
                  )}
                </div>

                {!canCorrect ? (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
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
                      <option value="correct">{t("corrections.payment.modeCorrect")}</option>
                      <option value="void">{t("corrections.payment.modeVoid")}</option>
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
                  <p className="text-sm text-indigo-700 font-medium">
                    {t("corrections.payment.saved", { op: formatOperationNumber(savedOperationNumber) })}
                  </p>
                )}
              </div>

              <div className="p-4 border-t border-slate-100 flex gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600"
                >
                  {isSaved ? t("common.close") : t("common.cancel")}
                </button>
                {canCorrect && !isSaved && (
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handlePrepareSubmit()}
                    className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-60"
                  >
                    {isPending ? t("common.saving") : t("corrections.payment.confirm")}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmOpen}
        title={t("corrections.payment.confirmTitle")}
        description={confirmDescription}
        confirmLabel={t("corrections.payment.confirmApply")}
        pending={isPending}
        onConfirm={() => void executeSubmit()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
