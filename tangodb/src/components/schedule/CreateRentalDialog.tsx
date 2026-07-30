import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Building2, Plus, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { minutesToTime, normalizeTime, timeToMinutes } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { useCreateRenter, useRenters } from "../../hooks/useRenters";
import { useCreateRental, useRentalConflictsPreview } from "../../hooks/useRentals";
import { useRentalTariffs } from "../../hooks/useRentalTariffs";
import { getPaymentMethodLabel } from "../../hooks/usePayments";
import type { PaymentMethod } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import DatePickerField from "../ui/DatePickerField";
import type { ScheduleCellPrefill } from "./AddLessonTypePopup";

export interface LocationOption {
  id: string;
  name: string;
}

interface CreateRentalDialogProps {
  open: boolean;
  prefill?: ScheduleCellPrefill | null;
  preselectedRenterId?: string | null;
  locations: LocationOption[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function defaultTimeEnd(timeStart: string): string {
  try {
    return minutesToTime(timeToMinutes(normalizeTime(timeStart)) + 240);
  } catch {
    return "16:00";
  }
}

export default function CreateRentalDialog({
  open,
  prefill,
  preselectedRenterId,
  locations,
  toast,
  onClose,
  onSuccess,
}: CreateRentalDialogProps) {
  const { t, formatDate, locale } = useI18n();
  const { can } = usePermissions();
  const canSeeFinance = can("finance.read");
  const createMutation = useCreateRental();
  const createRenterMutation = useCreateRenter();
  const rentersQuery = useRenters({ enabled: open, activeOnly: true });
  const tariffsQuery = useRentalTariffs({ status: "active" }, open && canSeeFinance);

  const defaultLocationId = prefill?.locationId ?? locations[0]?.id ?? "";

  const [step, setStep] = useState<"form" | "preview">("form");
  const [rentalDate, setRentalDate] = useState("");
  const [timeStart, setTimeStart] = useState("12:00");
  const [timeEnd, setTimeEnd] = useState("16:00");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [renterId, setRenterId] = useState("");
  const [newRenterName, setNewRenterName] = useState("");
  const [showNewRenter, setShowNewRenter] = useState(false);
  const [purpose, setPurpose] = useState("");
  const [internalComment, setInternalComment] = useState("");
  const [fixedAmount, setFixedAmount] = useState("");
  const [initialPayment, setInitialPayment] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [tariffId, setTariffId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [createRequested, setCreateRequested] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setRentalDate(prefill?.date ?? "");
    const start = prefill?.timeStart ?? "12:00";
    setTimeStart(start);
    setTimeEnd(prefill?.timeEnd ?? defaultTimeEnd(start));
    setLocationId(prefill?.locationId ?? defaultLocationId);
    setRenterId(preselectedRenterId ?? "");
    setNewRenterName("");
    setShowNewRenter(false);
    setPurpose("");
    setInternalComment("");
    setFixedAmount("");
    setInitialPayment("");
    setPaymentMethod("cash");
    setTariffId("");
    setIdempotencyKey(crypto.randomUUID());
    setCreateRequested(false);
  }, [open, prefill, defaultLocationId, preselectedRenterId]);

  const conflictsQuery = useRentalConflictsPreview(
    rentalDate,
    timeStart,
    timeEnd,
    locationId,
    step === "preview" && !!rentalDate && !!locationId
  );

  const locationName = locations.find((l) => l.id === locationId)?.name ?? "";
  const renterLabel = rentersQuery.data?.find((r) => r.id === renterId)?.displayName ?? "";

  const fixedTariffs = useMemo(
    () =>
      (tariffsQuery.data ?? []).filter(
        (tariff) =>
          tariff.tariffType === "fixed" &&
          (!tariff.locationId || tariff.locationId === locationId)
      ),
    [tariffsQuery.data, locationId]
  );

  const previewSummary = useMemo(() => {
    if (!rentalDate || !timeStart || !timeEnd) return "";
    return `${formatDate(rentalDate)} · ${timeStart}–${timeEnd}${locationName ? ` · ${locationName}` : ""}`;
  }, [rentalDate, timeStart, timeEnd, locationName, formatDate]);

  const handleCreateRenter = async () => {
    const name = newRenterName.trim();
    if (!name) {
      toast(t("schedule.rental.renterNameRequired"), "error");
      return;
    }
    const res = await createRenterMutation.mutateAsync({ displayName: name });
    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.rental.renterCreateFailed", t), "error");
      return;
    }
    setRenterId(res.renterId);
    setShowNewRenter(false);
    setNewRenterName("");
    toast(t("schedule.rental.renterCreated"), "success");
  };

  const validateForm = useCallback(() => {
    if (!rentalDate || !timeStart || !timeEnd || !locationId) {
      toast(t("schedule.rental.fieldsInvalid"), "error");
      return false;
    }
    if (timeToMinutes(timeEnd) <= timeToMinutes(timeStart)) {
      toast(t("schedule.rental.timeRangeInvalid"), "error");
      return false;
    }
    if (!renterId) {
      toast(t("schedule.rental.renterRequired"), "error");
      return false;
    }
    return true;
  }, [rentalDate, timeStart, timeEnd, locationId, renterId, toast, t]);

  const handleCreate = () => {
    if (!validateForm()) return;
    setCreateRequested(true);
    setStep("preview");
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;

    const conflicts = conflictsQuery.data;
    if (conflicts && !conflicts.success) {
      toast(resolveMutationError(conflicts.error, "schedule.rental.previewFailed", t), "error");
      return;
    }
    if (conflicts?.conflicts.length) {
      toast(t("schedule.rental.conflictBlocked"), "error");
      return;
    }

    const amount = canSeeFinance ? Number(fixedAmount) || 0 : 0;
    const payment = canSeeFinance ? Number(initialPayment) || 0 : 0;

    const res = await createMutation.mutateAsync({
      idempotencyKey,
      rentalDate,
      timeStart,
      timeEnd,
      locationId,
      renterId,
      tariffId: tariffId || null,
      purpose: purpose.trim() || undefined,
      internalComment: internalComment.trim() || undefined,
      fixedAmount: amount,
      initialPayment: payment,
      paymentMethod,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.rental.createFailed", t), "error");
      return;
    }

    if (res.alreadyApplied) {
      toast(t("schedule.rental.alreadyApplied"), "info");
    } else {
      toast(t("schedule.rental.createSuccess"), "success");
    }

    onSuccess();
    onClose();
  };

  useEffect(() => {
    if (!createRequested || step !== "preview" || !conflictsQuery.data?.success) return;

    if (conflictsQuery.data.conflicts.length > 0) {
      setCreateRequested(false);
      return;
    }

    setCreateRequested(false);
    void handleSubmit();
  }, [createRequested, step, conflictsQuery.data]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => !createMutation.isPending && onClose()}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
          />
          <motion.div
            initial={{ scale: 0.97, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.97, opacity: 0, y: 8 }}
            className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-lg w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">
                  {t("schedule.rental.title")}
                </h3>
                <p className="text-xs text-slate-500">{t("schedule.rental.subtitle")}</p>
              </div>
              <button type="button" onClick={onClose} disabled={createMutation.isPending} aria-label={t("common.close")} className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {step === "form" ? (
              <div className="space-y-4 font-sans">
                <DatePickerField label={t("schedule.rental.dateLabel")} value={rentalDate} onChange={setRentalDate} required />
                <div className="grid grid-cols-2 gap-3">
                  <div className="field-stack">
                    <label className={labelCls}>{t("common.timeStart")}</label>
                    <input type="time" className={fieldCls} value={timeStart} onChange={(e) => setTimeStart(e.target.value)} required />
                  </div>
                  <div className="field-stack">
                    <label className={labelCls}>{t("common.timeEnd")}</label>
                    <input type="time" className={fieldCls} value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} required />
                  </div>
                </div>
                <AppSelect label={t("schedule.form.location")} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </AppSelect>

                {!showNewRenter ? (
                  <div className="space-y-2">
                    <AppSelect label={t("schedule.rental.renterLabel")} value={renterId} onChange={(e) => setRenterId(e.target.value)}>
                      <option value="">{t("schedule.rental.selectRenter")}</option>
                      {(rentersQuery.data ?? []).map((r) => (
                        <option key={r.id} value={r.id}>{r.displayName}</option>
                      ))}
                    </AppSelect>
                    <button type="button" onClick={() => setShowNewRenter(true)} className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800 cursor-pointer">
                      <Plus className="w-3.5 h-3.5" />
                      {t("schedule.rental.addRenter")}
                    </button>
                    <Link to="/renters" className="block text-xs font-semibold text-indigo-600 hover:text-indigo-800">
                      {t("renters.manageLink")}
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                    <div>
                      <span className={labelCls}>{t("schedule.rental.newRenterName")}</span>
                      <input className={fieldCls} value={newRenterName} onChange={(e) => setNewRenterName(e.target.value)} />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => void handleCreateRenter()} disabled={createRenterMutation.isPending} className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-600 rounded-lg cursor-pointer">
                        {t("common.save")}
                      </button>
                      <button type="button" onClick={() => setShowNewRenter(false)} className="px-3 py-1.5 text-xs font-semibold text-slate-600 cursor-pointer">
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                )}

                <div>
                  <span className={labelCls}>{t("schedule.rental.purposeLabel")}</span>
                  <input className={fieldCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t("schedule.rental.purposePlaceholder")} />
                </div>

                {canSeeFinance && fixedTariffs.length > 0 ? (
                  <AppSelect label={t("rentalTariffs.fixedTariffLabel")} value={tariffId} onChange={(e) => setTariffId(e.target.value)}>
                    <option value="">{t("rentalTariffs.noTariff")}</option>
                    {fixedTariffs.map((tariff) => (
                      <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
                    ))}
                  </AppSelect>
                ) : null}

                {canSeeFinance ? (
                  <>
                    <div>
                      <span className={labelCls}>{t("schedule.rental.fixedAmountLabel")}</span>
                      <input type="number" min={0} step="0.01" className={fieldCls} value={fixedAmount} onChange={(e) => setFixedAmount(e.target.value)} />
                    </div>
                    <div>
                      <span className={labelCls}>{t("schedule.rental.initialPaymentLabel")}</span>
                      <input type="number" min={0} step="0.01" className={fieldCls} value={initialPayment} onChange={(e) => setInitialPayment(e.target.value)} />
                    </div>
                    <AppSelect label={t("finance.payroll.methodLabel")} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                      {(["cash", "transfer", "card", "other"] as PaymentMethod[]).map((m) => (
                        <option key={m} value={m}>{getPaymentMethodLabel(m, t, locale)}</option>
                      ))}
                    </AppSelect>
                  </>
                ) : null}

                <div>
                  <span className={labelCls}>{t("schedule.rental.commentLabel")}</span>
                  <input className={fieldCls} value={internalComment} onChange={(e) => setInternalComment(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">{t("schedule.rental.previewTitle")}</p>
                  <p className="mt-1 font-semibold text-slate-800">{previewSummary}</p>
                  {renterLabel ? <p className="text-slate-600 mt-1">{renterLabel}{purpose ? ` · ${purpose}` : ""}</p> : null}
                </div>
                {conflictsQuery.isLoading ? (
                  <p className="text-slate-400">{t("common.loading.default")}</p>
                ) : conflictsQuery.data && !conflictsQuery.data.success ? (
                  <p className="text-rose-600 text-xs">
                    {resolveMutationError(conflictsQuery.data.error, "schedule.rental.previewFailed", t)}
                  </p>
                ) : conflictsQuery.data?.conflicts.length ? (
                  <p className="text-rose-600 text-xs">{t("schedule.rental.conflictBlocked")}</p>
                ) : (
                  <p className="text-amber-700 text-xs">{t("schedule.rental.noConflicts")}</p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={step === "preview" ? () => setStep("form") : onClose}
                disabled={createMutation.isPending}
                className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer"
              >
                {t(step === "preview" ? "common.back" : "common.cancel")}
              </button>
              {step === "form" ? (
                <button type="button" onClick={handleCreate} disabled={createRequested} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-60">
                  <Building2 className="w-3.5 h-3.5" />
                  {t("schedule.rental.confirmCreate")}
                </button>
              ) : (
                <button type="button" onClick={() => void handleSubmit()} disabled={createMutation.isPending || !!conflictsQuery.data?.conflicts.length} className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-60">
                  {createMutation.isPending ? t("common.saving") : t("schedule.rental.confirmCreate")}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
