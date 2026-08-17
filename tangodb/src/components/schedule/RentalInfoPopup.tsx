import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Coins, Pencil, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useRentalDetail } from "../../hooks/useRentals";
import { memberListLabel, useTeamMembers } from "../../hooks/useTeamMembers";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import { rentalRemainingAmount } from "../../lib/rentalAmount";
import { filterVisibleRentalCorrectionPayments } from "../../lib/rentalPaymentCorrection";
import { canReadRentalTariffs, canWriteRentals } from "../../lib/permissions";
import { formatCurrency } from "../../lib/utils";
import type { RentalDisplayLesson } from "../../types";
import RecordRentalPaymentModal from "./RecordRentalPaymentModal";
import EditRentalAmountModal from "./EditRentalAmountModal";
import EditRentalSlotModal from "./EditRentalSlotModal";
import CancelRentalModal from "./CancelRentalModal";
import RentalTariffLookupLink from "./RentalTariffLookupLink";
import type { LocationOption } from "./CreateRentalDialog";

interface RentalInfoPopupProps {
  lesson: RentalDisplayLesson | null;
  locations: LocationOption[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

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
  const { t, formatDate, formatDateTime, locale } = useI18n();
  const { can, role, options } = usePermissions();
  const { isReadOnly } = useOrganization();
  const canSeeFinance = can("finance.read");
  const canSeeCashAmounts = can("rentals.payments.write");
  const canLookupTariffs = canReadRentalTariffs(role, options);
  const canManage =
    !isReadOnly && can("rentals.write");

  const detailQuery = useRentalDetail(lesson?.rentalId ?? null, !!lesson);
  const teamQuery = useTeamMembers();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [editAmountOpen, setEditAmountOpen] = useState(false);
  const [editSlotOpen, setEditSlotOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (!lesson) return null;

  const locationName = locations.find((l) => l.id === lesson.locationId)?.name;
  const detail = detailQuery.data;
  const seriesId = detail?.rentalSeriesId ?? lesson.rentalSeriesId ?? null;
  const displayTitle = lesson.renterName ?? t("schedule.rental.blockTitle");
  const paymentStatus = detail?.paymentStatus ?? lesson.paymentStatus;
  const calculatedAmount = detail?.calculatedAmount ?? null;
  const paidAmount = detail?.paidAmount ?? lesson.paidAmount ?? 0;
  const effectiveAmount = detail?.fixedAmount ?? lesson.fixedAmount ?? 0;
  const remaining = rentalRemainingAmount(effectiveAmount, paidAmount);
  const pricingBreakdown = detail?.pricingBreakdown;
  const memberNameById = new Map(
    (teamQuery.data ?? []).map((member) => [member.id, memberListLabel(member, locale)])
  );
  const visiblePayments = filterVisibleRentalCorrectionPayments(detail?.payments ?? []);

  const canRecordPayment =
    canSeeCashAmounts &&
    !isReadOnly &&
    lesson.bookingStatus === "confirmed" &&
    paymentStatus !== "paid" &&
    paymentStatus !== "overpaid";

  const canEditAmount =
    canSeeCashAmounts &&
    !isReadOnly &&
    lesson.bookingStatus === "confirmed";

  const canEditSlot =
    canWriteRentals(role, options) &&
    !isReadOnly &&
    lesson.bookingStatus === "confirmed";

  return (
    <>
      <AnimatePresence>
        <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-4" role="dialog" aria-modal="true">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-ink-950/40" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 24 }} className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-xl border border-ink-200 shadow-xl">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-ink-100">
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="w-4 h-4 text-amber-700 shrink-0" />
                <h3 className="text-base font-semibold text-ink-900 truncate">{displayTitle}</h3>
              </div>
              <button type="button" onClick={onClose} className="p-1.5 text-ink-400 hover:text-ink-600 rounded-lg cursor-pointer" aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-sm max-h-[70dvh] overflow-y-auto">
              <div>
                <span className={labelCls}>{t("schedule.rental.whenLabel")}</span>
                <p className="text-ink-800">{formatDate(lesson.date)} · {lesson.timeStart}–{lesson.timeEnd}</p>
              </div>
              {locationName ? (
                <div>
                  <span className={labelCls}>{t("schedule.form.location")}</span>
                  <p className="text-ink-800">{locationName}</p>
                </div>
              ) : null}
              {lesson.purpose ? (
                <div>
                  <span className={labelCls}>{t("schedule.rental.purposeLabel")}</span>
                  <p className="text-ink-800">{lesson.purpose}</p>
                </div>
              ) : null}
              {detail?.renter.displayName ? (
                <div>
                  <span className={labelCls}>{t("schedule.rental.renterLabel")}</span>
                  <p className="text-ink-800">{detail.renter.displayName}</p>
                </div>
              ) : null}
              {lesson.bookingStatus === "cancelled" || detail?.bookingStatus === "cancelled" ? (
                <p className="text-xs font-semibold text-garnet-600 uppercase">{t("schedule.rental.statusCancelled")}</p>
              ) : null}
              {seriesId ? (
                <div>
                  <span className={labelCls}>{t("rentalSeries.seriesLabel")}</span>
                  <p className="text-xs text-gold-700 font-semibold">{t("rentalSeries.partOfSeries")}</p>
                </div>
              ) : null}
              {canSeeCashAmounts && (effectiveAmount > 0 || calculatedAmount != null || paymentStatus) ? (
                <>
                  {canSeeFinance && calculatedAmount != null && calculatedAmount !== effectiveAmount ? (
                    <div>
                      <span className={labelCls}>{t("rentalSeries.calculatedAmountLabel")}</span>
                      <p className="text-ink-800">{formatCurrency(calculatedAmount)} {lesson.currency ?? "RUB"}</p>
                    </div>
                  ) : null}
                  {(effectiveAmount > 0 || paymentStatus) ? (
                    <div>
                      <span className={labelCls}>{t("schedule.rental.fixedAmountLabel")}</span>
                      <p className="text-ink-800">{formatCurrency(effectiveAmount)} {lesson.currency ?? "RUB"}</p>
                    </div>
                  ) : null}
                  {canSeeFinance && pricingBreakdown && Array.isArray(pricingBreakdown) ? (
                    <div>
                      <span className={labelCls}>{t("rentalSeries.pricingBreakdownLabel")}</span>
                      <ul className="mt-1 space-y-1 text-xs text-ink-700">
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
                    <p className="text-ink-800">{paymentStatusLabel(paymentStatus, t)}</p>
                    <p className="text-xs text-ink-500 mt-0.5">
                      {t("schedule.rental.paidSummary", { paid: formatCurrency(paidAmount), remaining: formatCurrency(remaining) })}
                    </p>
                  </div>
                  {canLookupTariffs ? <RentalTariffLookupLink className="mt-1" /> : null}
                  {visiblePayments.length ? (
                    <div>
                      <span className={labelCls}>{t("schedule.rental.paymentsLabel")}</span>
                      <ul className="mt-1 space-y-1 text-xs text-ink-700">
                        {visiblePayments.map((p) => {
                          const author = p.createdBy
                            ? memberNameById.get(p.createdBy) ?? t("team.auditSystem")
                            : t("team.auditSystem");
                          return (
                            <li key={p.id}>
                              {formatCurrency(p.amount)} · {getPaymentMethodLabel(p.method, t, locale)}
                              {p.operationDate ? (
                                <span className="text-ink-400"> · {formatDate(p.operationDate)}</span>
                              ) : null}
                              <span className="text-ink-400"> · {author}</span>
                              <span className="text-ink-400 text-[10px]">
                                {" "}
                                ({formatDateTime(p.createdAt, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2 px-4 py-3 border-t border-ink-100 bg-ink-50/10">
              {canEditAmount ? (
                <button
                  type="button"
                  onClick={() => setEditAmountOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-ink-700 bg-white border border-ink-200 rounded-lg cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t("schedule.rental.editAmountAction")}
                </button>
              ) : null}
              {canEditSlot ? (
                <button
                  type="button"
                  onClick={() => setEditSlotOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-ink-700 bg-white border border-ink-200 rounded-lg cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  {t("schedule.rental.editSlotAction")}
                </button>
              ) : null}
              {canRecordPayment ? (
                <button type="button" onClick={() => setPaymentOpen(true)} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg cursor-pointer">
                  <Coins className="w-3.5 h-3.5" />
                  {t("schedule.rental.recordPaymentTitle")}
                </button>
              ) : null}
              {canManage && lesson.bookingStatus === "confirmed" ? (
                <button type="button" onClick={() => setCancelOpen(true)} className="px-3 py-2 text-xs font-semibold text-garnet-700 bg-garnet-50 border border-garnet-200 rounded-lg cursor-pointer">
                  {seriesId ? t("rentalSeries.cancelOccurrenceAction") : t("schedule.rental.cancelAction")}
                </button>
              ) : null}
            </div>
          </motion.div>
        </div>
      </AnimatePresence>

      <EditRentalAmountModal
        lesson={lesson}
        currentAmount={effectiveAmount}
        paidAmount={paidAmount}
        open={editAmountOpen}
        toast={toast}
        onClose={() => setEditAmountOpen(false)}
        onSuccess={() => {
          onSuccess();
          void detailQuery.refetch();
        }}
      />

      <EditRentalSlotModal
        lesson={lesson}
        locations={locations}
        open={editSlotOpen}
        toast={toast}
        onClose={() => setEditSlotOpen(false)}
        onSuccess={() => {
          onSuccess();
          void detailQuery.refetch();
        }}
      />

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

      <CancelRentalModal
        open={cancelOpen}
        mode={seriesId ? "series_occurrence" : "single"}
        rentalId={lesson.rentalId}
        seriesId={seriesId}
        occurrenceDate={lesson.date}
        paidAmount={paidAmount}
        effectiveAmount={effectiveAmount}
        currency={lesson.currency ?? detail?.currency ?? "RUB"}
        toast={toast}
        onClose={() => setCancelOpen(false)}
        onSuccess={() => {
          onSuccess();
          onClose();
        }}
      />
    </>
  );
}
