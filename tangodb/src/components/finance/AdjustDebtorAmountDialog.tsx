import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Pencil, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import {
  usePersonalLessonDebtTrace,
  useRestatePersonalLessonAmount,
  useWriteOffPersonalLessonDebt,
  type PersonalLessonDebtTraceKind,
} from "../../hooks/usePersonalLessons";
import { useAdjustRentalAmount } from "../../hooks/useRentals";
import {
  PAYMENT_CORRECTION_REASONS,
  type PaymentCorrectionReasonCode,
} from "../../lib/paymentCorrection";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import type { DebtorEntry } from "../../lib/financeReports";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import ConfirmDialog from "../ui/ConfirmDialog";
import { btnAddCls, btnDestructiveCls } from "../ui/buttonStyles";
import type { I18nKey } from "../../lib/i18n/keys";

interface AdjustDebtorAmountDialogProps {
  entry: DebtorEntry | null;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function debtTraceEventLabel(kind: PersonalLessonDebtTraceKind): I18nKey {
  switch (kind) {
    case "charge_created":
      return "finance.debtors.trace.event.chargeCreated";
    case "storno":
      return "finance.debtors.trace.event.storno";
    case "billed_restated":
      return "finance.debtors.trace.event.billedRestated";
    case "write_off":
      return "finance.debtors.trace.event.writeOff";
    default:
      return "finance.debtors.trace.event.payment";
  }
}

function personalDebtTraceHint(
  billed: number,
  paid: number,
  outstanding: number,
  events: { kind: PersonalLessonDebtTraceKind }[]
): I18nKey | null {
  const hasJournalChange = events.some(
    (event) => event.kind === "storno" || event.kind === "billed_restated" || event.kind === "write_off"
  );
  if (hasJournalChange && outstanding > 0.005) return "finance.debtors.trace.hintCorrection";
  if (paid > 0.005 && outstanding > 0.005) return "finance.debtors.trace.hintPartial";
  if (paid <= 0.005 && outstanding > 0.005) return "finance.debtors.trace.hintUnpaid";
  return null;
}

function PersonalLessonDebtTrace({
  lessonId,
  chargeId,
  billedAmount,
  paidAmount,
  outstanding,
}: {
  lessonId: string;
  chargeId: string | null;
  billedAmount: number;
  paidAmount: number;
  outstanding: number;
}) {
  const { t, formatDateTime } = useI18n();
  const traceQuery = usePersonalLessonDebtTrace(lessonId, chargeId, { enabled: Boolean(lessonId) });
  const events = traceQuery.data?.events ?? [];
  const hint = personalDebtTraceHint(billedAmount, paidAmount, outstanding, events);

  return (
    <div className="space-y-2">
      <p className={labelCls}>{t("finance.debtors.trace.title")}</p>
      <p className="text-[11px] text-slate-600 leading-snug">
        {t("finance.debtors.trace.formula", {
          billed: formatCurrency(billedAmount),
          paid: formatCurrency(paidAmount),
          debt: formatCurrency(outstanding),
        })}
      </p>
      {hint ? <p className="text-[11px] text-rose-700 leading-snug">{t(hint)}</p> : null}
      {traceQuery.isLoading ? (
        <p className="text-[11px] text-slate-500">{t("finance.debtors.trace.loading")}</p>
      ) : traceQuery.isError ? (
        <p className="text-[11px] text-rose-700">{t("finance.debtors.traceFailed")}</p>
      ) : events.length === 0 ? (
        <p className="text-[11px] text-slate-500">{t("finance.debtors.trace.empty")}</p>
      ) : (
        <ul className="space-y-1.5 max-h-36 overflow-y-auto">
          {events.map((event, index) => (
            <li
              key={`${event.kind}-${event.at}-${index}`}
              className="flex justify-between gap-3 text-[11px] text-slate-600"
            >
              <span className="min-w-0 truncate">
                {event.at
                  ? formatDateTime(event.at, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
                {" · "}
                {t(debtTraceEventLabel(event.kind))}
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatCurrency(event.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function AdjustDebtorAmountDialog({
  entry,
  toast,
  onClose,
  onSuccess,
}: AdjustDebtorAmountDialogProps) {
  const { t } = useI18n();
  const restatePersonal = useRestatePersonalLessonAmount();
  const writeOffPersonal = useWriteOffPersonalLessonDebt();
  const adjustRental = useAdjustRentalAmount();

  const paidAmount = entry?.paidAmount ?? 0;
  const billedAmount = entry?.billedAmount ?? entry?.amount ?? 0;
  const outstanding = entry?.amount ?? 0;
  const isGroup = Boolean(entry?.id.startsWith("grp-"));
  const canWriteOff =
    entry?.kind === "personal" && Boolean(entry.personalLessonId) && outstanding > 0 && !isGroup;

  const [newOutstanding, setNewOutstanding] = useState("");
  const [reason, setReason] = useState("");
  const [reasonCode, setReasonCode] = useState<PaymentCorrectionReasonCode>("wrong_amount");
  const [reasonComment, setReasonComment] = useState("");
  const [confirmWriteOff, setConfirmWriteOff] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setNewOutstanding(outstanding > 0 ? String(outstanding) : "0");
    setReason("");
    setReasonCode("wrong_amount");
    setReasonComment("");
    setConfirmWriteOff(false);
  }, [entry, outstanding]);

  const parsedOutstanding = useMemo(() => {
    const value = Number(newOutstanding);
    return Number.isFinite(value) ? value : null;
  }, [newOutstanding]);

  const newBilled = parsedOutstanding != null ? paidAmount + parsedOutstanding : null;
  const pending = restatePersonal.isPending || adjustRental.isPending || writeOffPersonal.isPending;

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

  const handlePrepareWriteOff = () => {
    if (!canWriteOff || !entry?.personalLessonId) return;
    if (!reasonComment.trim()) {
      toast(t("finance.debtors.writeOffReasonRequired"), "error");
      return;
    }
    setConfirmWriteOff(true);
  };

  const handleWriteOff = async () => {
    if (!canWriteOff || !entry?.personalLessonId) return;
    setConfirmWriteOff(false);
    const res = await writeOffPersonal.mutateAsync({
      lessonId: entry.personalLessonId,
      chargeId: entry.personalLessonChargeId ?? null,
      reasonCode,
      reasonComment: reasonComment.trim(),
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "finance.debtors.writeOffFailed", t), "error");
      return;
    }
    setConfirmWriteOff(false);
    toast(t("finance.debtors.writeOffSuccess"), "success");
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
            className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl max-h-[90vh] overflow-y-auto"
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
                <>
                  <AppSelect
                    label={t("corrections.payment.reason")}
                    value={reasonCode}
                    onChange={(e) => setReasonCode(e.target.value as PaymentCorrectionReasonCode)}
                  >
                    {PAYMENT_CORRECTION_REASONS.map((r) => (
                      <option key={r.code} value={r.code}>
                        {t(r.labelKey as I18nKey)}
                      </option>
                    ))}
                  </AppSelect>
                  <div>
                    <span className={labelCls}>{t("finance.debtors.writeOffReason")}</span>
                    <textarea
                      className={`${fieldCls} min-h-[72px]`}
                      value={reasonComment}
                      onChange={(e) => setReasonComment(e.target.value)}
                      placeholder={t("finance.debtors.writeOffReasonPlaceholder")}
                    />
                  </div>
                  {isGroup ? (
                    <p className="text-[11px] text-slate-500">{t("finance.debtors.writeOffGroupHint")}</p>
                  ) : entry.personalLessonId ? (
                    <PersonalLessonDebtTrace
                      lessonId={entry.personalLessonId}
                      chargeId={entry.personalLessonChargeId ?? null}
                      billedAmount={billedAmount}
                      paidAmount={paidAmount}
                      outstanding={outstanding}
                    />
                  ) : (
                    <p className="text-[11px] text-slate-500">{t("finance.debtors.adjustPersonalHint")}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              {canWriteOff ? (
                <button
                  type="button"
                  onClick={handlePrepareWriteOff}
                  disabled={pending}
                  className={btnDestructiveCls}
                >
                  {t("common.delete")}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
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
            </div>
          </motion.div>
          <ConfirmDialog
            open={confirmWriteOff}
            title={t("finance.debtors.writeOffTitle")}
            description={t("finance.debtors.writeOffConfirm", {
              billed: formatCurrency(billedAmount),
              paid: formatCurrency(paidAmount),
              debt: formatCurrency(outstanding),
            })}
            confirmLabel={t("finance.debtors.writeOffConfirmAction")}
            pending={writeOffPersonal.isPending}
            onConfirm={() => void handleWriteOff()}
            onCancel={() => setConfirmWriteOff(false)}
            zClassName="z-[90]"
          />
        </div>
      ) : null}
    </AnimatePresence>
  );
}
