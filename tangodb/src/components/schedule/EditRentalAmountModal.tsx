import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pencil, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useAdjustRentalAmount } from "../../hooks/useRentals";
import { useI18n } from "../../hooks/useI18n";
import { rentalRemainingAmount } from "../../lib/rentalAmount";
import { formatCurrency } from "../../lib/utils";
import type { RentalDisplayLesson } from "../../types";
import { fieldCls } from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";

interface EditRentalAmountModalProps {
  lesson: RentalDisplayLesson | null;
  currentAmount: number;
  paidAmount: number;
  open: boolean;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function EditRentalAmountModal({
  lesson,
  currentAmount,
  paidAmount,
  open,
  toast,
  onClose,
  onSuccess,
}: EditRentalAmountModalProps) {
  const { t } = useI18n();
  const adjustAmount = useAdjustRentalAmount();

  const [newAmount, setNewAmount] = useState("");
  const [reason, setReason] = useState("");

  const parsedNewAmount = useMemo(() => {
    const value = Number(newAmount);
    return Number.isFinite(value) ? value : null;
  }, [newAmount]);

  const previewRemaining = useMemo(() => {
    if (parsedNewAmount == null) return null;
    return rentalRemainingAmount(parsedNewAmount, paidAmount);
  }, [parsedNewAmount, paidAmount]);

  useEffect(() => {
    if (!open || !lesson) return;
    setNewAmount(currentAmount > 0 ? String(currentAmount) : "");
    setReason("");
  }, [open, lesson, currentAmount]);

  const handleSubmit = async () => {
    if (!lesson) return;

    if (parsedNewAmount == null || parsedNewAmount < 0) {
      toast(t("schedule.rental.amountInvalid"), "error");
      return;
    }

    if (!reason.trim()) {
      toast(t("schedule.rental.amountReasonRequired"), "error");
      return;
    }

    if (parsedNewAmount < paidAmount) {
      toast(t("schedule.rental.paidExceedsFixed"), "error");
      return;
    }

    if (parsedNewAmount === currentAmount) {
      toast(t("schedule.rental.amountUnchanged"), "info");
      return;
    }

    const res = await adjustAmount.mutateAsync({
      rentalId: lesson.rentalId,
      newAmount: parsedNewAmount,
      reason: reason.trim(),
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.rental.amountAdjustFailed", t), "error");
      return;
    }

    toast(t("schedule.rental.amountAdjustSuccess"), "success");
    onSuccess();
    onClose();
  };

  const title = lesson?.renterName ?? lesson?.purpose ?? t("schedule.rental.blockTitle");
  const currency = lesson?.currency ?? "RUB";

  return (
    <AnimatePresence>
      {open && lesson && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => !adjustAmount.isPending && onClose()}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <Pencil className="w-4 h-4 text-amber-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{t("schedule.rental.editAmountTitle")}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={adjustAmount.isPending}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-slate-600">{title}</p>
              <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-xs text-slate-600 space-y-1">
                <p>
                  {t("schedule.rental.amountChangeCurrent")}: {formatCurrency(currentAmount)} {currency}
                </p>
                {paidAmount > 0 ? (
                  <p>
                    {t("schedule.rental.paidSummary", {
                      paid: formatCurrency(paidAmount),
                      remaining: formatCurrency(rentalRemainingAmount(currentAmount, paidAmount)),
                    })}
                  </p>
                ) : null}
              </div>
              <div>
                <span className={labelCls}>{t("schedule.rental.newAmountLabel")}</span>
                <input
                  type="number"
                  min={paidAmount}
                  step="0.01"
                  className={fieldCls}
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                />
              </div>
              {previewRemaining != null && parsedNewAmount !== currentAmount ? (
                <p className="text-xs text-slate-500">
                  {t("schedule.rental.amountChangePreview", {
                    old: formatCurrency(currentAmount),
                    new: formatCurrency(parsedNewAmount),
                    remaining: formatCurrency(previewRemaining),
                  })}
                </p>
              ) : null}
              <div>
                <span className={labelCls}>{t("schedule.rental.amountReasonLabel")}</span>
                <textarea
                  className={`${fieldCls} min-h-[72px]`}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("schedule.rental.amountReasonPlaceholder")}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <button
                type="button"
                onClick={onClose}
                disabled={adjustAmount.isPending}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={adjustAmount.isPending}
                className={btnAddCls}
              >
                {adjustAmount.isPending ? t("common.saving") : t("schedule.rental.editAmountSubmit")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
