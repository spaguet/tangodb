import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { useCancelRental } from "../../hooks/useRentals";
import {
  useCancelRentalSeriesOccurrence,
  type RentalCancelFinancialAction,
} from "../../hooks/useRentalSeries";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export type CancelRentalMode = "single" | "series_occurrence";

interface CancelRentalModalProps {
  open: boolean;
  mode: CancelRentalMode;
  rentalId: string;
  seriesId?: string | null;
  occurrenceDate?: string;
  paidAmount: number;
  effectiveAmount: number;
  currency?: string;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const UNPAID_ACTIONS: RentalCancelFinancialAction[] = ["none", "full_penalty", "partial_penalty", "manual"];
const PAID_ACTIONS: RentalCancelFinancialAction[] = [
  "refund",
  "transfer_to_advance",
  "full_penalty",
  "partial_penalty",
  "manual",
];

function defaultAction(paidAmount: number): RentalCancelFinancialAction {
  return paidAmount > 0 ? "refund" : "none";
}

export default function CancelRentalModal({
  open,
  mode,
  rentalId,
  seriesId,
  occurrenceDate,
  paidAmount,
  effectiveAmount,
  currency = "RUB",
  toast,
  onClose,
  onSuccess,
}: CancelRentalModalProps) {
  const { t } = useI18n();
  const { can } = usePermissions();
  const canCorrectFinancial = can("finance.read");

  const cancelMutation = useCancelRental();
  const cancelOccurrenceMutation = useCancelRentalSeriesOccurrence();
  const isPending = cancelMutation.isPending || cancelOccurrenceMutation.isPending;

  const [reason, setReason] = useState("");
  const [financialAction, setFinancialAction] = useState<RentalCancelFinancialAction>(() =>
    defaultAction(paidAmount)
  );
  const [penaltyAmount, setPenaltyAmount] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!open) return;
    setReason("");
    setFinancialAction(defaultAction(paidAmount));
    setPenaltyAmount("");
    setIdempotencyKey(crypto.randomUUID());
  }, [open, paidAmount]);

  const availableActions = useMemo(() => {
    const base = paidAmount > 0 ? PAID_ACTIONS : UNPAID_ACTIONS;
    if (!canCorrectFinancial) {
      return base.filter((a) => a !== "refund" && a !== "transfer_to_advance");
    }
    return base;
  }, [paidAmount, canCorrectFinancial]);

  useEffect(() => {
    if (!availableActions.includes(financialAction)) {
      setFinancialAction(availableActions[0] ?? "none");
    }
  }, [availableActions, financialAction]);

  const preview = useMemo(() => {
    const penalty =
      financialAction === "partial_penalty" ? Number(penaltyAmount) || 0 : effectiveAmount;
    const chargeAfter =
      financialAction === "none" || financialAction === "refund" || financialAction === "transfer_to_advance"
        ? 0
        : financialAction === "full_penalty"
          ? effectiveAmount
          : financialAction === "partial_penalty"
            ? penalty
            : effectiveAmount;

    const paidAfter =
      financialAction === "refund" || financialAction === "transfer_to_advance" ? 0 : paidAmount;

    const debtAfter = Math.max(0, chargeAfter - paidAfter);
    const creditAfter = Math.max(0, paidAfter - chargeAfter);

    return { chargeAfter, paidAfter, debtAfter, creditAfter };
  }, [financialAction, penaltyAmount, effectiveAmount, paidAmount]);

  const handleSubmit = async () => {
    if (!reason.trim()) {
      toast(t("schedule.rental.cancelReasonRequired"), "error");
      return;
    }

    if (financialAction === "partial_penalty") {
      const penalty = Number(penaltyAmount);
      if (!Number.isFinite(penalty) || penalty <= 0) {
        toast(t("rental.cancel.penaltyInvalid"), "error");
        return;
      }
    }

    if (
      paidAmount > 0 &&
      (financialAction === "refund" || financialAction === "transfer_to_advance") &&
      !canCorrectFinancial
    ) {
      toast(t("rental.cancel.financeForbidden"), "error");
      return;
    }

    const payload = {
      reason: reason.trim(),
      financialAction,
      penaltyAmount:
        financialAction === "partial_penalty" ? Number(penaltyAmount) : null,
      idempotencyKey,
    };

    const res =
      mode === "series_occurrence" && seriesId && occurrenceDate
        ? await cancelOccurrenceMutation.mutateAsync({
            seriesId,
            date: occurrenceDate,
            ...payload,
          })
        : await cancelMutation.mutateAsync({ rentalId, ...payload });

    if (!res.success) {
      toast(
        resolveMutationError(
          res.error,
          mode === "series_occurrence"
            ? "rentalSeries.error.cancelOccurrenceFailed"
            : "schedule.rental.cancelFailed",
          t
        ),
        "error"
      );
      return;
    }

    toast(
      mode === "series_occurrence"
        ? t("rentalSeries.cancelOccurrenceSuccess")
        : t("schedule.rental.cancelSuccess"),
      "success"
    );
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40"
            onClick={() => !isPending && onClose()}
          />
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl p-4 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <h4 className="font-semibold text-slate-900">
              {mode === "series_occurrence"
                ? t("rentalSeries.cancelOccurrenceAction")
                : t("schedule.rental.cancelAction")}
            </h4>

            {paidAmount > 0 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-900 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>{t("rental.cancel.paidWarning", { amount: formatCurrency(paidAmount) })}</p>
              </div>
            ) : null}

            <div>
              <span className={labelCls}>{t("schedule.rental.cancelReasonLabel")}</span>
              <textarea
                className={`${fieldCls} min-h-[80px]`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>

            <AppSelect
              label={t("rental.cancel.financialActionLabel")}
              value={financialAction}
              onChange={(e) => setFinancialAction(e.target.value as RentalCancelFinancialAction)}
            >
              {availableActions.map((action) => (
                <option key={action} value={action}>
                  {t(`rental.cancel.action.${action}` as import("../../lib/i18n/keys").I18nKey)}
                </option>
              ))}
            </AppSelect>

            {financialAction === "partial_penalty" ? (
              <div>
                <span className={labelCls}>{t("rental.cancel.penaltyAmountLabel")}</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className={fieldCls}
                  value={penaltyAmount}
                  onChange={(e) => setPenaltyAmount(e.target.value)}
                />
              </div>
            ) : null}

            {!canCorrectFinancial && paidAmount > 0 ? (
              <p className="text-xs text-slate-500">{t("rental.cancel.escalateFinance")}</p>
            ) : null}

            <div className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-xs space-y-1">
              <p className="font-semibold text-slate-700">{t("rental.cancel.previewTitle")}</p>
              <p className="text-slate-600">
                {t("rental.cancel.previewCharge", {
                  amount: formatCurrency(preview.chargeAfter),
                  currency,
                })}
              </p>
              <p className="text-slate-600">
                {t("rental.cancel.previewPaid", {
                  amount: formatCurrency(preview.paidAfter),
                  currency,
                })}
              </p>
              {preview.debtAfter > 0 ? (
                <p className="text-rose-700 font-medium">
                  {t("rental.cancel.previewDebt", {
                    amount: formatCurrency(preview.debtAfter),
                    currency,
                  })}
                </p>
              ) : null}
              {preview.creditAfter > 0 ? (
                <p className="text-green-700 font-medium">
                  {t("rental.cancel.previewCredit", {
                    amount: formatCurrency(preview.creditAfter),
                    currency,
                  })}
                </p>
              ) : null}
              {financialAction === "transfer_to_advance" && paidAmount > 0 ? (
                <p className="text-indigo-700">{t("rental.cancel.previewAdvance")}</p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="px-3 py-2 text-xs font-semibold text-slate-600 cursor-pointer"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={isPending}
                className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg cursor-pointer disabled:opacity-60"
              >
                {isPending
                  ? t("common.saving")
                  : mode === "series_occurrence"
                    ? t("rentalSeries.confirmCancelOccurrence")
                    : t("schedule.rental.confirmCancel")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
