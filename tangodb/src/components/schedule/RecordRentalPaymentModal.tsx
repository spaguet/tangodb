import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import { useRecordRentalPayment } from "../../hooks/useRentals";
import { useRentalBillingProfile } from "../../hooks/useRentalBillingProfile";
import { useI18n } from "../../hooks/useI18n";
import { rentalRemainingAmount } from "../../lib/rentalAmount";
import { minOpenOperationDate, orgLocalDateString } from "../../lib/orgFinanceDate";
import { formatCurrency } from "../../lib/utils";
import type { PaymentMethod, RentalDisplayLesson } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import DatePickerField from "../ui/DatePickerField";
import { useOrganization } from "../../organization/OrganizationProvider";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";
import {
  EMPTY_FISCAL_VALUES,
  RentalFiscalPaymentFields,
  fiscalValuesToInput,
} from "../rental-billing/RentalFiscalPaymentFields";

interface RecordRentalPaymentModalProps {
  lesson: RentalDisplayLesson | null;
  open: boolean;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export default function RecordRentalPaymentModal({
  lesson,
  open,
  toast,
  onClose,
  onSuccess,
}: RecordRentalPaymentModalProps) {
  const { t, locale } = useI18n();
  const { settings } = useOrganization();
  const billingProfileQuery = useRentalBillingProfile();
  const recordPayment = useRecordRentalPayment();

  const orgTimezone = settings?.timezone ?? "UTC";
  const closedUntil = settings?.finance_period_closed_until ?? null;
  const orgToday = orgLocalDateString(orgTimezone);
  const minOperationDate = minOpenOperationDate(closedUntil);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [methodComment, setMethodComment] = useState("");
  const [operationDate, setOperationDate] = useState(orgToday);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [fiscalValues, setFiscalValues] = useState(EMPTY_FISCAL_VALUES);

  const fiscalTrackingEnabled = billingProfileQuery.data?.fiscal_tracking_enabled ?? false;

  const remaining = useMemo(() => {
    if (!lesson) return 0;
    return rentalRemainingAmount(lesson.fixedAmount, lesson.paidAmount);
  }, [lesson]);

  useEffect(() => {
    if (!open || !lesson) return;
    setAmount(remaining > 0 ? String(remaining) : "");
    setMethod("cash");
    setMethodComment("");
    setOperationDate(orgLocalDateString(orgTimezone));
    setIdempotencyKey(crypto.randomUUID());
    setFiscalValues(EMPTY_FISCAL_VALUES);
  }, [open, lesson, remaining, orgTimezone]);

  const handleSubmit = async () => {
    if (!lesson) return;
    const value = Number(amount);
    if (!value || value <= 0) {
      toast(t("schedule.rental.paymentAmountInvalid"), "error");
      return;
    }

    if (remaining > 0 && value > remaining) {
      const confirmed = window.confirm(
        t("schedule.rental.overpaymentConfirm", {
          amount: formatCurrency(value),
          remaining: formatCurrency(remaining),
        })
      );
      if (!confirmed) return;
    }

    const res = await recordPayment.mutateAsync({
      rentalId: lesson.rentalId,
      amount: value,
      method,
      methodComment: methodComment.trim() || undefined,
      idempotencyKey,
      operationDate,
      fiscal: fiscalTrackingEnabled ? fiscalValuesToInput(fiscalValues) : undefined,
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
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-ink-950/40" onClick={() => !recordPayment.isPending && onClose()} />
          <motion.div initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }} className="relative w-full max-w-md bg-white rounded-xl border border-ink-200 shadow-xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-100">
              <div className="flex items-center gap-2 min-w-0">
                <Coins className="w-4 h-4 text-gold-700 shrink-0" />
                <h3 className="text-base font-semibold text-ink-900 truncate">{t("schedule.rental.recordPaymentTitle")}</h3>
              </div>
              <button type="button" onClick={onClose} disabled={recordPayment.isPending} className="p-1.5 text-ink-400 hover:text-ink-600 rounded-lg cursor-pointer" aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-sm text-ink-600">{title}</p>
              {(lesson.fixedAmount ?? 0) > 0 ? (
                <p className="text-xs text-ink-500">
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
              <DatePickerField
                label={t("finance.operationDate.label")}
                value={operationDate}
                onChange={setOperationDate}
                min={minOperationDate}
                max={orgToday}
              />
              <div>
                <span className={labelCls}>{t("schedule.rental.paymentCommentLabel")}</span>
                <input
                  className={fieldCls}
                  value={methodComment}
                  onChange={(e) => setMethodComment(e.target.value)}
                  placeholder={t("schedule.rental.paymentCommentPlaceholder")}
                />
              </div>
              <RentalFiscalPaymentFields
                enabled={fiscalTrackingEnabled}
                method={method}
                values={fiscalValues}
                onChange={setFiscalValues}
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-ink-100 bg-ink-50/10">
              <button type="button" onClick={onClose} disabled={recordPayment.isPending} className="px-3 py-2 text-xs font-semibold text-ink-600 hover:bg-ink-100 rounded-lg cursor-pointer">{t("common.cancel")}</button>
              <button type="button" onClick={() => void handleSubmit()} disabled={recordPayment.isPending} className={btnAddCls}>
                {recordPayment.isPending ? t("common.saving") : t("schedule.rental.recordPaymentSubmit")}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
