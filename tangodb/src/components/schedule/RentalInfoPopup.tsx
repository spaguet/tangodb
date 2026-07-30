import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Coins, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useCancelRental, useRentalDetail } from "../../hooks/useRentals";
import { useCancelRentalSeriesOccurrence } from "../../hooks/useRentalSeries";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import { formatCurrency } from "../../lib/utils";
import { resolveMutationError } from "../../lib/resolveMutationError";
import type { RentalDisplayLesson } from "../../types";
import RecordRentalPaymentModal from "./RecordRentalPaymentModal";
import type { LocationOption } from "./CreateRentalDialog";

interface RentalInfoPopupProps {
  lesson: RentalDisplayLesson | null;
  locations: LocationOption[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function paymentStatusLabel(status: string | null | undefined, t: (key: string) => string): string {
  if (status === "paid") return t("schedule.rental.paymentPaid");
  if (status === "partial") return t("schedule.rental.paymentPartial");
  if (status === "overpaid") return t("schedule.rental.paymentOverpaid");
  return t("schedule.rental.paymentUnpaid");
}

export default function RentalInfoPopup({
  lesson,
  locations,
  toast,
  onClose,
  onSuccess,
}: RentalInfoPopupProps) {
  const { t, formatDate, locale } = useI18n();
  const { can, role } = usePermissions();
  const { isReadOnly } = useOrganization();
  const canSeeFinance = can("finance.read");
  const canManage =
    !isReadOnly &&
    can("schedule.write") &&
    (role === "owner" || role === "director" || role === "admin");

  const detailQuery = useRentalDetail(lesson?.rentalId ?? null, !!lesson);
  const cancelMutation = useCancelRental();
  const cancelOccurrenceMutation = useCancelRentalSeriesOccurrence();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelOccurrenceOpen, setCancelOccurrenceOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  if (!lesson) return null;

  const locationName = locations.find((l) => l.id === lesson.locationId)?.name;
  const detail = detailQuery.data;
  const seriesId = detail?.rentalSeriesId ?? lesson.rentalSeriesId ?? null;
  const displayTitle = lesson.renterName ?? t("schedule.rental.blockTitle");
  const paymentStatus = detail?.paymentStatus ?? lesson.paymentStatus;
  const fixedAmount = detail?.fixedAmount ?? lesson.fixedAmount ?? 0;
  const calculatedAmount = detail?.calculatedAmount ?? null;
  const paidAmount = detail?.paidAmount ?? lesson.paidAmount ?? 0;
  const remaining = Math.max(0, fixedAmount - paidAmount);
  const pricingBreakdown = detail?.pricingBreakdown;

  const canRecordPayment =
    canSeeFinance &&
    !isReadOnly &&
    lesson.bookingStatus === "confirmed" &&
    paymentStatus !== "paid" &&
    paymentStatus !== "overpaid";

  const handleCancel = async () => {
    if (!cancelReason.trim()) {
      toast(t("schedule.rental.cancelReasonRequired"), "error");
      return;
    }
    const res = await cancelMutation.mutateAsync({ rentalId: lesson.rentalId, reason: cancelReason.trim() });
    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.rental.cancelFailed", t), "error");
      return;
    }
    toast(t("schedule.rental.cancelSuccess"), "success");
    onSuccess();
    onClose();
  };

  const handleCancelOccurrence = async () => {
    if (!seriesId) return;
    if (!cancelReason.trim()) {
      toast(t("schedule.rental.cancelReasonRequired"), "error");
      return;
    }
    const res = await cancelOccurrenceMutation.mutateAsync({
      seriesId,
      date: lesson.date,
      reason: cancelReason.trim(),
      financialAction: "none",
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalSeries.error.cancelOccurrenceFailed", t), "error");
      return;
    }
    toast(t("rentalSeries.cancelOccurrenceSuccess"), "success");
    onSuccess();
    onClose();
  };

  return (
    <>
      <AnimatePresence>
        <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-xl border border-slate-200 shadow-xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-amber-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{displayTitle}</h3>
              </div>
              <button type="button" onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer" aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-sm max-h-[70dvh] overflow-y-auto">
              <div>
                <span className={labelCls}>{t("schedule.rental.whenLabel")}</span>
                <p className="text-slate-800">{formatDate(lesson.date)} · {lesson.timeStart}–{lesson.timeEnd}</p>
              </div>
              {locationName ? (
                <div>
                  <span className={labelCls}>{t("schedule.form.location")}</span>
                  <p className="text-slate-800">{locationName}</p>
                </div>
              ) : null}
              {lesson.purpose ? (
                <div>
                  <span className={labelCls}>{t("schedule.rental.purposeLabel")}</span>
                  <p className="text-slate-800">{lesson.purpose}</p>
                </div>
              ) : null}
              {detail?.renter.displayName ? (
                <div>
                  <span className={labelCls}>{t("schedule.rental.renterLabel")}</span>
                  <p className="text-slate-800">{detail.renter.displayName}</p>
                </div>
              ) : null}
              {lesson.bookingStatus === "cancelled" || detail?.bookingStatus === "cancelled" ? (
                <p className="text-xs font-semibold text-rose-600 uppercase">{t("schedule.rental.statusCancelled")}</p>
              ) : null}
              {seriesId ? (
                <div>
                  <span className={labelCls}>{t("rentalSeries.seriesLabel")}</span>
                  <p className="text-xs text-indigo-700 font-semibold">{t("rentalSeries.partOfSeries")}</p>
                </div>
              ) : null}
              {canSeeFinance && (fixedAmount > 0 || calculatedAmount != null) ? (
                <>
                  {calculatedAmount != null && calculatedAmount !== fixedAmount ? (
                    <div>
                      <span className={labelCls}>{t("rentalSeries.calculatedAmountLabel")}</span>
                      <p className="text-slate-800">{formatCurrency(calculatedAmount)} {lesson.currency ?? "RUB"}</p>
                    </div>
                  ) : null}
                  <div>
                    <span className={labelCls}>{t("schedule.rental.fixedAmountLabel")}</span>
                    <p className="text-slate-800">{formatCurrency(fixedAmount)} {lesson.currency ?? "RUB"}</p>
                  </div>
                  {pricingBreakdown && Array.isArray(pricingBreakdown) ? (
                    <div>
                      <span className={labelCls}>{t("rentalSeries.pricingBreakdownLabel")}</span>
                      <ul className="mt-1 space-y-1 text-xs text-slate-700">
                        {(pricingBreakdown as Record<string, unknown>[]).map((line, idx) => (
                          <li key={idx} className="flex justify-between gap-2">
                            <span>{String(line.label ?? line.description ?? t("rentalSeries.pricingLine"))}</span>
                            <span>{line.amount != null ? formatCurrency(Number(line.amount)) : ""}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <div>
                    <span className={labelCls}>{t("schedule.rental.paymentStatusLabel")}</span>
                    <p className="text-slate-800">{paymentStatusLabel(paymentStatus, t)}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {t("schedule.rental.paidSummary", { paid: formatCurrency(paidAmount), remaining: formatCurrency(remaining) })}
                    </p>
                  </div>
                  {detail?.payments.length ? (
                    <div>
                      <span className={labelCls}>{t("schedule.rental.paymentsLabel")}</span>
                      <ul className="mt-1 space-y-1 text-xs text-slate-700">
                        {detail.payments.map((p) => (
                          <li key={p.id}>
                            {formatCurrency(p.amount)} · {getPaymentMethodLabel(p.method, t, locale)}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              {canRecordPayment ? (
                <button type="button" onClick={() => setPaymentOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                  <Coins className="w-3.5 h-3.5" />
                  {t("schedule.rental.recordPaymentTitle")}
                </button>
              ) : null}
              {canManage && lesson.bookingStatus === "confirmed" ? (
                seriesId ? (
                  <button type="button" onClick={() => setCancelOccurrenceOpen(true)} className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg cursor-pointer">
                    {t("rentalSeries.cancelOccurrenceAction")}
                  </button>
                ) : (
                  <button type="button" onClick={() => setCancelOpen(true)} className="px-3 py-2 text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg cursor-pointer">
                    {t("schedule.rental.cancelAction")}
                  </button>
                )
              ) : null}
            </div>
          </motion.div>
        </div>
      </AnimatePresence>

      <RecordRentalPaymentModal
        lesson={lesson}
        open={paymentOpen}
        toast={toast}
        onClose={() => setPaymentOpen(false)}
        onSuccess={() => {
          onSuccess();
          void detailQuery.refetch();
        }}
      />

      <AnimatePresence>
        {cancelOccurrenceOpen && (
          <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40" onClick={() => !cancelOccurrenceMutation.isPending && setCancelOccurrenceOpen(false)} />
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl p-4 space-y-3">
              <h4 className="font-semibold text-slate-900">{t("rentalSeries.cancelOccurrenceAction")}</h4>
              <div>
                <span className={labelCls}>{t("schedule.rental.cancelReasonLabel")}</span>
                <textarea className={`${fieldCls} min-h-[80px]`} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCancelOccurrenceOpen(false)} className="px-3 py-2 text-xs font-semibold text-slate-600 cursor-pointer">{t("common.cancel")}</button>
                <button type="button" onClick={() => void handleCancelOccurrence()} disabled={cancelOccurrenceMutation.isPending} className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg cursor-pointer disabled:opacity-60">
                  {cancelOccurrenceMutation.isPending ? t("common.saving") : t("rentalSeries.confirmCancelOccurrence")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cancelOpen && (
          <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/40" onClick={() => !cancelMutation.isPending && setCancelOpen(false)} />
            <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl p-4 space-y-3">
              <h4 className="font-semibold text-slate-900">{t("schedule.rental.cancelAction")}</h4>
              <div>
                <span className={labelCls}>{t("schedule.rental.cancelReasonLabel")}</span>
                <textarea className={`${fieldCls} min-h-[80px]`} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setCancelOpen(false)} className="px-3 py-2 text-xs font-semibold text-slate-600 cursor-pointer">{t("common.cancel")}</button>
                <button type="button" onClick={() => void handleCancel()} disabled={cancelMutation.isPending} className="px-4 py-2 text-xs font-semibold text-white bg-rose-600 rounded-lg cursor-pointer disabled:opacity-60">
                  {cancelMutation.isPending ? t("common.saving") : t("schedule.rental.confirmCancel")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

const fieldCls = "w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/30";
