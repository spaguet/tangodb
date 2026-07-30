import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import { useRecordRentalPayment } from "../../hooks/useRentals";
import { useI18n } from "../../hooks/useI18n";
import { formatCurrency } from "../../lib/utils";
import type { PaymentMethod, RentalDisplayLesson } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";

interface RecordRentalPaymentModalProps {
  lesson: RentalDisplayLesson | null;
  open: boolean;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function RecordRentalPaymentModal({
  lesson,
  open,
  toast,
  onClose,
  onSuccess,
}: RecordRentalPaymentModalProps) {
  const { t, locale } = useI18n();
  const recordPayment = useRecordRentalPayment();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [methodComment, setMethodComment] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const remaining = useMemo(() => {
    if (!lesson) return 0;
    const fixed = lesson.fixedAmount ?? 0;
    const paid = lesson.paidAmount ?? 0;
    return Math.max(0, fixed - paid);
  }, [lesson]);

  useEffect(() => {
    if (!open || !lesson) return;
    setAmount(remaining > 0 ? String(remaining) : "");
    setMethod("cash");
    setMethodComment("");
    setIdempotencyKey(crypto.randomUUID());
  }, [open, lesson, remaining]);

  const handleSubmit = async () => {
    if (!lesson) return;
    const value = Number(amount);
    if (!value || value <= 0) {
      toast(t("schedule.rental.paymentAmountInvalid"), "error");
      return;
    }

    const res = await recordPayment.mutateAsync({
      rentalId: lesson.rentalId,
      amount: value,
      method,
      methodComment: methodComment.trim() || undefined,
      idempotencyKey,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.rental.paymentFailed", t), "error");
      return;
    }

    if (res.alreadyApplied) {
      toast(t("schedule.rental.paymentAlreadyApplied"), "info");
    } else {
      toast(t("schedule.rental.paymentSuccess"), "success");
    }

    onSuccess();
    onClose();
  };

  const title = lesson?.renterName ?? lesson?.purpose ?? t("schedule.rental.blockTitle");

  return (
    <AnimatePresence>
      {open && lesson && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40" onClick={() => !recordPayment.isPending && onClose()} />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }} className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <Coins className="w-4 h-4 text-amber-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{t("schedule.rental.recordPaymentTitle")}</h3>
              </div>
              <button type="button" onClick={onClose} disabled={recordPayment.isPending} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer" aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-600">{title}</p>
              {(lesson.fixedAmount ?? 0) > 0 ? (
                <p className="text-xs text-slate-500">
                  {t("schedule.rental.remainingLabel")}: {formatCurrency(remaining)} {lesson.currency ?? "RUB"}
                </p>
              ) : null}
              <div>
                <span className={labelCls}>{t("schedule.rental.paymentAmountLabel")}</span>
                <input type="number" min={0} step="0.01" className={fieldCls} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <AppSelect label={t("finance.payroll.methodLabel")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {(["cash", "transfer", "card", "other"] as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>{getPaymentMethodLabel(m, t, locale)}</option>
                ))}
              </AppSelect>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <button type="button" onClick={onClose} disabled={recordPayment.isPending} className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer">{t("common.cancel")}</button>
              <button type="button" onClick={() => void handleSubmit()} disabled={recordPayment.isPending} className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-lg cursor-pointer">
                {recordPayment.isPending ? t("common.saving") : t("schedule.rental.recordPaymentSubmit")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
