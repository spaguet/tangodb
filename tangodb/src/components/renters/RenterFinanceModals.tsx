import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Coins, FileText, Wallet, X } from "lucide-react";
import type { ToastType } from "../../App";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import { useI18n } from "../../hooks/useI18n";
import {
  useAllocateRentalAdvance,
  useCancelRentalAdvanceAllocation,
  useCreateRentalInvoice,
  useRecordRentalAdvance,
  useRecordRentalInvoicePayment,
} from "../../hooks/useRentalInvoices";
import { useRentalBillingProfile } from "../../hooks/useRentalBillingProfile";
import { minOpenOperationDate, orgLocalDateString } from "../../lib/orgFinanceDate";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { formatCurrency } from "../../lib/utils";
import type { PaymentMethod, RentalAdvance, RentalAdvanceAllocation, RentalInvoice } from "../../types";
import { useOrganization } from "../../organization/OrganizationProvider";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import DatePickerField from "../ui/DatePickerField";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";
import {
  EMPTY_FISCAL_VALUES,
  RentalFiscalPaymentFields,
  fiscalValuesToInput,
} from "../rental-billing/RentalFiscalPaymentFields";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

type ToastFn = (msg: string, type?: ToastType) => void;

function ModalShell({
  open,
  title,
  icon: Icon,
  onClose,
  pending,
  children,
  t,
}: {
  open: boolean;
  title: string;
  icon: typeof Coins;
  onClose: () => void;
  pending: boolean;
  children: React.ReactNode;
  t: (key: import("../../lib/i18n/keys").I18nKey, vars?: Record<string, string | number>) => string;
}) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
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
                <Icon className="w-4 h-4 text-indigo-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{title}</h3>
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
            <div className="p-4 space-y-3">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function CreateRentalInvoiceModal({
  open,
  renterId,
  defaultPeriodStart,
  defaultPeriodEnd,
  onClose,
  onSuccess,
  toast,
}: {
  open: boolean;
  renterId: string;
  defaultPeriodStart: string;
  defaultPeriodEnd: string;
  onClose: () => void;
  onSuccess: () => void;
  toast: ToastFn;
}) {
  const { t } = useI18n();
  const createInvoice = useCreateRentalInvoice();
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [dueDate, setDueDate] = useState(defaultPeriodEnd);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (!open) return;
    setPeriodStart(defaultPeriodStart);
    setPeriodEnd(defaultPeriodEnd);
    setDueDate(defaultPeriodEnd);
    setIdempotencyKey(crypto.randomUUID());
  }, [open, defaultPeriodStart, defaultPeriodEnd]);

  const handleSubmit = async () => {
    if (!periodStart || !periodEnd || periodStart > periodEnd) {
      toast(t("rentalInvoices.error.periodInvalid"), "error");
      return;
    }
    const res = await createInvoice.mutateAsync({
      idempotencyKey,
      renterId,
      periodStart,
      periodEnd,
      dueDate: dueDate || periodEnd,
      status: "invoiced",
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalInvoices.error.createFailed", t), "error");
      return;
    }
    toast(
      res.alreadyApplied
        ? t("rentalInvoices.success.invoiceAlreadyApplied")
        : t("rentalInvoices.success.invoiceCreated", { amount: formatCurrency(res.totalAmount ?? 0) }),
      res.alreadyApplied ? "info" : "success"
    );
    onSuccess();
    onClose();
  };

  return (
    <ModalShell open={open} title={t("rentalInvoices.createTitle")} icon={FileText} onClose={onClose} pending={createInvoice.isPending} t={t}>
      <DatePickerField label={t("rentalInvoices.periodStart")} value={periodStart} onChange={setPeriodStart} />
      <DatePickerField label={t("rentalInvoices.periodEnd")} value={periodEnd} onChange={setPeriodEnd} />
      <DatePickerField label={t("rentalInvoices.dueDate")} value={dueDate} onChange={setDueDate} />
      <p className="text-xs text-slate-500">{t("rentalInvoices.createHint")}</p>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} disabled={createInvoice.isPending} className={btnCancelCls}>
          {t("common.cancel")}
        </button>
        <button type="button" onClick={() => void handleSubmit()} disabled={createInvoice.isPending} className={btnAddCls}>
          {t("rentalInvoices.createAction")}
        </button>
      </div>
    </ModalShell>
  );
}

export function PayRentalInvoiceModal({
  open,
  invoice,
  renterId,
  onClose,
  onSuccess,
  toast,
}: {
  open: boolean;
  invoice: RentalInvoice | null;
  renterId: string;
  onClose: () => void;
  onSuccess: () => void;
  toast: ToastFn;
}) {
  const { t } = useI18n();
  const { settings } = useOrganization();
  const billingProfileQuery = useRentalBillingProfile();
  const recordPayment = useRecordRentalInvoicePayment();
  const orgTimezone = settings?.timezone ?? "UTC";
  const closedUntil = settings?.finance_period_closed_until ?? null;
  const orgToday = orgLocalDateString(orgTimezone);
  const minOperationDate = minOpenOperationDate(closedUntil);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [operationDate, setOperationDate] = useState(orgToday);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [fiscalValues, setFiscalValues] = useState(EMPTY_FISCAL_VALUES);

  const fiscalTrackingEnabled = billingProfileQuery.data?.fiscal_tracking_enabled ?? false;
  const outstanding = invoice?.outstanding ?? 0;

  useEffect(() => {
    if (!open || !invoice) return;
    setAmount(outstanding > 0 ? String(outstanding) : "");
    setMethod("cash");
    setOperationDate(orgLocalDateString(orgTimezone));
    setIdempotencyKey(crypto.randomUUID());
    setFiscalValues(EMPTY_FISCAL_VALUES);
  }, [open, invoice, outstanding, orgTimezone]);

  const handleSubmit = async () => {
    if (!invoice) return;
    const value = Number(amount);
    if (!value || value <= 0) {
      toast(t("schedule.rental.paymentAmountInvalid"), "error");
      return;
    }
    if (outstanding > 0 && value > outstanding) {
      const confirmed = window.confirm(
        t("schedule.rental.overpaymentConfirm", {
          amount: formatCurrency(value),
          remaining: formatCurrency(outstanding),
        })
      );
      if (!confirmed) return;
    }
    const res = await recordPayment.mutateAsync({
      invoiceId: invoice.id,
      amount: value,
      method,
      idempotencyKey,
      operationDate,
      renterId,
      fiscal: fiscalTrackingEnabled ? fiscalValuesToInput(fiscalValues) : undefined,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalInvoices.error.paymentFailed", t), "error");
      return;
    }
    toast(
      res.alreadyApplied ? t("rentalInvoices.success.paymentAlreadyApplied") : t("rentalInvoices.success.paymentRecorded"),
      res.alreadyApplied ? "info" : "success"
    );
    onSuccess();
    onClose();
  };

  return (
    <ModalShell open={open} title={t("rentalInvoices.payTitle")} icon={Coins} onClose={onClose} pending={recordPayment.isPending} t={t}>
      {invoice ? (
        <>
          <p className="text-xs text-slate-600">
            {t("rentalInvoices.period")}: {invoice.periodStart} – {invoice.periodEnd}
          </p>
          <p className="text-sm font-semibold text-slate-800">
            {t("rentalInvoices.outstanding")}: {formatCurrency(outstanding)}
          </p>
          <div>
            <label className={labelCls}>{t("schedule.rental.paymentAmountLabel")}</label>
            <input className={fieldCls} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <AppSelect label={t("common.paymentMethod")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(["cash", "card", "transfer", "other"] as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>
                {getPaymentMethodLabel(m, t)}
              </option>
            ))}
          </AppSelect>
          <DatePickerField
            label={t("finance.operationDate.label")}
            value={operationDate}
            onChange={setOperationDate}
            min={minOperationDate}
            max={orgToday}
          />
          <RentalFiscalPaymentFields
            enabled={fiscalTrackingEnabled}
            method={method}
            values={fiscalValues}
            onChange={setFiscalValues}
          />
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={recordPayment.isPending} className={btnCancelCls}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => void handleSubmit()} disabled={recordPayment.isPending} className={btnAddCls}>
              {t("rentalInvoices.payAction")}
            </button>
          </div>
        </>
      ) : null}
    </ModalShell>
  );
}

export function RecordRentalAdvanceModal({
  open,
  renterId,
  onClose,
  onSuccess,
  toast,
}: {
  open: boolean;
  renterId: string;
  onClose: () => void;
  onSuccess: () => void;
  toast: ToastFn;
}) {
  const { t } = useI18n();
  const { settings } = useOrganization();
  const recordAdvance = useRecordRentalAdvance();
  const orgTimezone = settings?.timezone ?? "UTC";
  const closedUntil = settings?.finance_period_closed_until ?? null;
  const orgToday = orgLocalDateString(orgTimezone);
  const minOperationDate = minOpenOperationDate(closedUntil);

  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("transfer");
  const [notes, setNotes] = useState("");
  const [operationDate, setOperationDate] = useState(orgToday);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (!open) return;
    setAmount("");
    setMethod("transfer");
    setNotes("");
    setOperationDate(orgLocalDateString(orgTimezone));
    setIdempotencyKey(crypto.randomUUID());
  }, [open, orgTimezone]);

  const handleSubmit = async () => {
    const value = Number(amount);
    if (!value || value <= 0) {
      toast(t("schedule.rental.paymentAmountInvalid"), "error");
      return;
    }
    const res = await recordAdvance.mutateAsync({
      renterId,
      amount: value,
      method,
      idempotencyKey,
      operationDate,
      notes: notes.trim() || undefined,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalInvoices.error.advanceFailed", t), "error");
      return;
    }
    toast(
      res.alreadyApplied ? t("rentalInvoices.success.advanceAlreadyApplied") : t("rentalInvoices.success.advanceRecorded"),
      res.alreadyApplied ? "info" : "success"
    );
    onSuccess();
    onClose();
  };

  return (
    <ModalShell open={open} title={t("rentalInvoices.advanceTitle")} icon={Wallet} onClose={onClose} pending={recordAdvance.isPending} t={t}>
      <div>
        <label className={labelCls}>{t("schedule.rental.paymentAmountLabel")}</label>
        <input className={fieldCls} type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <AppSelect label={t("common.paymentMethod")} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
        {(["cash", "card", "transfer", "other"] as PaymentMethod[]).map((m) => (
          <option key={m} value={m}>
            {getPaymentMethodLabel(m, t)}
          </option>
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
        <label className={labelCls}>{t("rentalInvoices.advanceNotes")}</label>
        <input className={fieldCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onClose} disabled={recordAdvance.isPending} className={btnCancelCls}>
          {t("common.cancel")}
        </button>
        <button type="button" onClick={() => void handleSubmit()} disabled={recordAdvance.isPending} className={btnAddCls}>
          {t("rentalInvoices.advanceAction")}
        </button>
      </div>
    </ModalShell>
  );
}

export function AllocateRentalAdvanceModal({
  open,
  renterId,
  advances,
  invoices,
  onClose,
  onSuccess,
  toast,
}: {
  open: boolean;
  renterId: string;
  advances: RentalAdvance[];
  invoices: RentalInvoice[];
  onClose: () => void;
  onSuccess: () => void;
  toast: ToastFn;
}) {
  const { t } = useI18n();
  const allocate = useAllocateRentalAdvance();

  const payableInvoices = useMemo(
    () => invoices.filter((inv) => inv.status !== "cancelled" && inv.status !== "paid" && inv.outstanding > 0),
    [invoices]
  );
  const availableAdvances = useMemo(() => advances.filter((a) => a.available > 0), [advances]);

  const [advanceId, setAdvanceId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [amount, setAmount] = useState("");

  const selectedAdvance = availableAdvances.find((a) => a.id === advanceId);
  const selectedInvoice = payableInvoices.find((i) => i.id === invoiceId);
  const maxAmount = selectedAdvance && selectedInvoice ? Math.min(selectedAdvance.available, selectedInvoice.outstanding) : 0;

  useEffect(() => {
    if (!open) return;
    const firstAdvance = availableAdvances[0]?.id ?? "";
    const firstInvoice = payableInvoices[0]?.id ?? "";
    setAdvanceId(firstAdvance);
    setInvoiceId(firstInvoice);
    setAmount("");
  }, [open, availableAdvances, payableInvoices]);

  useEffect(() => {
    if (maxAmount > 0 && !amount) {
      setAmount(String(maxAmount));
    }
  }, [maxAmount, amount]);

  const handleSubmit = async () => {
    const value = Number(amount);
    if (!advanceId || !invoiceId || !value || value <= 0) {
      toast(t("rentalInvoices.error.allocateInvalid"), "error");
      return;
    }
    if (value > maxAmount) {
      toast(t("rentalInvoices.error.allocateExceeds"), "error");
      return;
    }
    const res = await allocate.mutateAsync({ advanceId, invoiceId, amount: value, renterId });
    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalInvoices.error.allocateFailed", t), "error");
      return;
    }
    toast(t("rentalInvoices.success.allocated"), "success");
    onSuccess();
    onClose();
  };

  return (
    <ModalShell open={open} title={t("rentalInvoices.allocateTitle")} icon={Wallet} onClose={onClose} pending={allocate.isPending} t={t}>
      {availableAdvances.length === 0 || payableInvoices.length === 0 ? (
        <p className="text-sm text-slate-500">{t("rentalInvoices.allocateUnavailable")}</p>
      ) : (
        <>
          <AppSelect label={t("rentalInvoices.advanceSelect")} value={advanceId} onChange={(e) => setAdvanceId(e.target.value)}>
            {availableAdvances.map((a) => (
              <option key={a.id} value={a.id}>
                {formatCurrency(a.available)} · {a.operationDate}
              </option>
            ))}
          </AppSelect>
          <AppSelect label={t("rentalInvoices.invoiceSelect")} value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            {payableInvoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                {inv.periodStart} – {inv.periodEnd} · {formatCurrency(inv.outstanding)}
              </option>
            ))}
          </AppSelect>
          <div>
            <label className={labelCls}>{t("rentalInvoices.allocateAmount")}</label>
            <input className={fieldCls} type="number" min="0" step="0.01" max={maxAmount} value={amount} onChange={(e) => setAmount(e.target.value)} />
            {maxAmount > 0 ? (
              <p className="text-xs text-slate-400 mt-1">{t("rentalInvoices.allocateMax", { amount: formatCurrency(maxAmount) })}</p>
            ) : null}
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} disabled={allocate.isPending} className={btnCancelCls}>
              {t("common.cancel")}
            </button>
            <button type="button" onClick={() => void handleSubmit()} disabled={allocate.isPending} className={btnAddCls}>
              {t("rentalInvoices.allocateAction")}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

export function RentalAdvanceAllocationHistory({
  allocations,
  canWrite,
  renterId,
  toast,
  formatDate,
  t,
}: {
  allocations: RentalAdvanceAllocation[];
  canWrite: boolean;
  renterId: string;
  toast: ToastFn;
  formatDate: (d: string) => string;
  t: (key: import("../../lib/i18n/keys").I18nKey) => string;
}) {
  const cancelAllocation = useCancelRentalAdvanceAllocation();

  if (allocations.length === 0) return null;

  const handleCancel = async (allocationId: string) => {
    if (!window.confirm(t("rentalInvoices.cancelAllocationConfirm"))) return;
    const res = await cancelAllocation.mutateAsync({ allocationId, renterId });
    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalInvoices.error.cancelAllocationFailed", t), "error");
      return;
    }
    toast(t("rentalInvoices.success.allocationCancelled"), "success");
  };

  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-800 mb-2">{t("rentalInvoices.allocationHistory")}</h4>
      <ul className="text-xs space-y-2">
        {allocations.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-2 border-b border-slate-50 pb-2">
            <div>
              <p className="text-slate-800 font-medium">
                {formatCurrency(row.amount)} → {formatDate(row.invoicePeriodStart)} – {formatDate(row.invoicePeriodEnd)}
              </p>
              <p className="text-slate-400">
                {formatDate(row.allocatedAt.slice(0, 10))}
                {row.cancelledAt ? ` · ${t("rentalInvoices.allocationCancelled")}` : ""}
              </p>
            </div>
            {canWrite && !row.cancelledAt ? (
              <button
                type="button"
                onClick={() => void handleCancel(row.id)}
                disabled={cancelAllocation.isPending}
                className="text-xs font-semibold text-rose-600 cursor-pointer shrink-0"
              >
                {t("rentalInvoices.cancelAllocation")}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
