import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pencil, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useRestatePersonalLessonAmount } from "../../hooks/usePersonalLessons";
import { useAdjustRentalAmount } from "../../hooks/useRentals";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import type { DebtorEntry } from "../../lib/financeReports";
import { fieldCls } from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";

interface AdjustDebtorAmountDialogProps {
  entry: DebtorEntry | null;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function AdjustDebtorAmountDialog({
  entry,
  toast,
  onClose,
  onSuccess,
}: AdjustDebtorAmountDialogProps) {
  const { t } = useI18n();
  const restatePersonal = useRestatePersonalLessonAmount();
  const adjustRental = useAdjustRentalAmount();

  const paidAmount = entry?.paidAmount ?? 0;
  const billedAmount = entry?.billedAmount ?? entry?.amount ?? 0;
  const outstanding = entry?.amount ?? 0;

  const [newOutstanding, setNewOutstanding] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (!entry) return;
    setNewOutstanding(outstanding > 0 ? String(outstanding) : "0");
    setReason("");
  }, [entry, outstanding]);

  const parsedOutstanding = useMemo(() => {
    const value = Number(newOutstanding);
    return Number.isFinite(value) ? value : null;
  }, [newOutstanding]);

  const newBilled = parsedOutstanding != null ? paidAmount + parsedOutstanding : null;
  const pending = restatePersonal.isPending || adjustRental.isPending;

  const handleSubmit = async () => {
    if (!entry) return;
    if (parsedOutstanding == null || parsedOutstanding < 0) {
      toast(t("finance.debtors.adjustInvalid"), "error");
      return;
    }
    if (newBilled == null) return;
    if (parsedOutstanding === outstanding) {
      toast(t("finance.debtors.adjustUnchanged"), "info");
      return;
    }

    if (entry.kind === "personal") {
      if (!entry.personalLessonId) return;
      const res = await restatePersonal.mutateAsync({
        lessonId: entry.personalLessonId,
        newAmount: newBilled,
      });
      if (!res.success) {
        toast(resolveMutationError(res.error, "finance.debtors.adjustFailed", t), "error");
        return;
      }
    } else if (entry.kind === "rental") {
      if (!entry.rentalId) return;
      if (!reason.trim()) {
        toast(t("schedule.rental.amountReasonRequired"), "error");
        return;
      }
      const res = await adjustRental.mutateAsync({
        rentalId: entry.rentalId,
        newAmount: newBilled,
        reason: reason.trim(),
      });
      if (!res.success) {
        toast(resolveMutationError(res.error, "finance.debtors.adjustFailed", t), "error");
        return;
      }
    } else {
      return;
    }

    toast(t("finance.debtors.adjustSuccess"), "success");
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {entry ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => !pending && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <Pencil className="w-4 h-4 text-indigo-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">
                  {t("finance.debtors.adjustTitle")}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm font-semibold text-slate-800">{entry.clientDisplay}</p>
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600 space-y-1">
                <p>
                  {t("finance.debtors.adjustBilled")}: {formatCurrency(billedAmount)}
                </p>
                <p>
                  {t("finance.debtors.adjustPaid")}: {formatCurrency(paidAmount)}
                </p>
                <p className="font-semibold text-rose-700">
                  {t("finance.debtors.outstanding")}: {formatCurrency(outstanding)}
                </p>
              </div>
              <div>
                <span className={labelCls}>{t("finance.debtors.adjustOutstanding")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={fieldCls}
                  value={newOutstanding}
                  onChange={(e) => setNewOutstanding(e.target.value)}
                />
              </div>
              {newBilled != null && parsedOutstanding !== outstanding ? (
                <p className="text-xs text-slate-500">
                  {t("finance.debtors.adjustPreview", {
                    billed: formatCurrency(newBilled),
                    outstanding: formatCurrency(parsedOutstanding ?? 0),
                  })}
                </p>
              ) : null}
              {entry.kind === "rental" ? (
                <div>
                  <span className={labelCls}>{t("schedule.rental.amountReasonLabel")}</span>
                  <textarea
                    className={`${fieldCls} min-h-[72px]`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder={t("schedule.rental.amountReasonPlaceholder")}
                  />
                </div>
              ) : (
                <p className="text-[11px] text-slate-500">{t("finance.debtors.adjustPersonalHint")}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={pending}
                className={btnAddCls}
              >
                {pending ? t("common.saving") : t("finance.debtors.adjustSubmit")}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
