import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import { useRecordCalendarEventPayment } from "../../hooks/useCalendarEvents";
import { useI18n } from "../../hooks/useI18n";
import { formatCurrency } from "../../lib/utils";
import type { EventDisplayLesson, PaymentMethod } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";

interface RecordCalendarEventPaymentModalProps {
  lesson: EventDisplayLesson | null;
  open: boolean;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export default function RecordCalendarEventPaymentModal({
  lesson,
  open,
  toast,
  onClose,
  onSuccess,
}: RecordCalendarEventPaymentModalProps) {
  const { t, locale } = useI18n();
  const recordPayment = useRecordCalendarEventPayment();

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [methodComment, setMethodComment] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const remaining = useMemo(() => {
    if (!lesson) return 0;
    const income = lesson.incomeAmount ?? 0;
    const paid = lesson.paidAmount ?? 0;
    return Math.max(0, income - paid);
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
      toast(t("schedule.event.paymentAmountInvalid"), "error");
      return;
    }

    const res = await recordPayment.mutateAsync({
      eventId: lesson.eventId,
      amount: value,
      method,
      methodComment: methodComment.trim() || undefined,
      idempotencyKey,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.event.paymentFailed", t), "error");
      return;
    }

    if (res.alreadyApplied) {
      toast(t("schedule.event.paymentAlreadyApplied"), "info");
    } else {
      toast(t("schedule.event.paymentSuccess"), "success");
    }

    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && lesson && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-ink-950/40"
            onClick={() => !recordPayment.isPending && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-md bg-white rounded-xl border border-ink-200 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-100">
              <div className="flex items-center gap-2 min-w-0">
                <Coins className="w-4 h-4 text-lavender-600 shrink-0" />
                <h3 className="text-base font-semibold text-ink-900 truncate">{t("schedule.event.recordPaymentTitle")}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={recordPayment.isPending}
                className="p-1.5 text-ink-400 hover:text-ink-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-sm text-ink-600">{lesson.title}</p>
              {(lesson.incomeAmount ?? 0) > 0 ? (
                <p className="text-xs text-ink-500">
                  {t("schedule.event.remainingLabel")}: {formatCurrency(remaining)} {lesson.currency ?? "RUB"}
                </p>
              ) : null}
              <div>
                <span className={labelCls}>{t("schedule.event.paymentAmountLabel")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={fieldCls}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <AppSelect
                label={t("finance.payroll.methodLabel")}
                value={method}
                onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              >
                {(["cash", "transfer", "card", "other"] as PaymentMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {getPaymentMethodLabel(m, t, locale)}
                  </option>
                ))}
              </AppSelect>
              <div>
                <span className={labelCls}>{t("schedule.event.paymentCommentLabel")}</span>
                <input className={fieldCls} value={methodComment} onChange={(e) => setMethodComment(e.target.value)} />
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-ink-100 bg-ink-50/10">
              <button
                type="button"
                onClick={onClose}
                disabled={recordPayment.isPending}
                className="px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-100 rounded-lg cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={recordPayment.isPending}
                className="px-4 py-2 text-xs font-semibold text-white bg-lavender-600 hover:bg-lavender-700 disabled:opacity-50 rounded-lg cursor-pointer"
              >
                {recordPayment.isPending ? t("common.saving") : t("schedule.event.recordPaymentSubmit")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
