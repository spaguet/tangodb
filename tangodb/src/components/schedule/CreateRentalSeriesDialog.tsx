import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { CalendarRange, Plus, X } from "lucide-react";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import DatePickerField from "../ui/DatePickerField";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { timeToMinutes } from "../../lib/scheduleWeek";
import { useI18n } from "../../hooks/useI18n";
import { usePermissions } from "../../hooks/usePermissions";
import { useCreateRenter, useRenters } from "../../hooks/useRenters";
import { useRentalTariffs } from "../../hooks/useRentalTariffs";
import {
  useCreateRentalSeries,
  usePreviewRentalSeries,
  type RentalSeriesPayload,
} from "../../hooks/useRentalSeries";
import { formatCurrency } from "../../lib/utils";
import type { RentalSeriesPattern } from "../../types";
import type { LocationOption } from "./CreateRentalDialog";
import type { ScheduleCellPrefill } from "./AddLessonTypePopup";

interface CreateRentalSeriesDialogProps {
  open: boolean;
  prefill?: ScheduleCellPrefill | null;
  preselectedRenterId?: string | null;
  locations: LocationOption[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const WEEK_DAYS = [1, 2, 3, 4, 5, 6, 7] as const;

function emptyPattern(prefill?: ScheduleCellPrefill | null): RentalSeriesPattern {
  return {
    daysOfWeek: prefill?.dayOfWeek ? [prefill.dayOfWeek] : [1],
    timeStart: prefill?.timeStart ?? "12:00",
    timeEnd: prefill?.timeEnd ?? "16:00",
  };
}

export default function CreateRentalSeriesDialog({
  open,
  prefill,
  preselectedRenterId,
  locations,
  toast,
  onClose,
  onSuccess,
}: CreateRentalSeriesDialogProps) {
  const { t, formatDate } = useI18n();
  const { can } = usePermissions();
  const canSeeFinance = can("finance.read");

  const createMutation = useCreateRentalSeries();
  const createRenterMutation = useCreateRenter();
  const rentersQuery = useRenters({ enabled: open, activeOnly: true });
  const tariffsQuery = useRentalTariffs({ status: "active" }, open);

  const defaultLocationId = prefill?.locationId ?? locations[0]?.id ?? "";

  const [step, setStep] = useState<"form" | "preview">("form");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [locationId, setLocationId] = useState(defaultLocationId);
  const [renterId, setRenterId] = useState("");
  const [tariffId, setTariffId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [patterns, setPatterns] = useState<RentalSeriesPattern[]>([emptyPattern(prefill)]);
  const [newRenterName, setNewRenterName] = useState("");
  const [showNewRenter, setShowNewRenter] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (!open) return;
    setStep("form");
    setValidFrom(prefill?.date ?? "");
    setValidTo(prefill?.date ?? "");
    setLocationId(prefill?.locationId ?? defaultLocationId);
    setRenterId(preselectedRenterId ?? "");
    setTariffId("");
    setPurpose("");
    setPatterns([emptyPattern(prefill)]);
    setNewRenterName("");
    setShowNewRenter(false);
    setIdempotencyKey(crypto.randomUUID());
  }, [open, prefill, defaultLocationId, preselectedRenterId]);

  const filteredTariffs = useMemo(
    () =>
      (tariffsQuery.data ?? []).filter(
        (tariff) => !tariff.locationId || tariff.locationId === locationId
      ),
    [tariffsQuery.data, locationId]
  );

  const seriesPayload = useMemo((): RentalSeriesPayload | null => {
    if (!renterId || !locationId || !tariffId || !validFrom || !validTo || patterns.length === 0) {
      return null;
    }
    return {
      renterId,
      locationId,
      tariffId,
      validFrom,
      validTo,
      purpose: purpose.trim() || undefined,
      patterns,
    };
  }, [renterId, locationId, tariffId, validFrom, validTo, purpose, patterns]);

  const previewQuery = usePreviewRentalSeries(seriesPayload, step === "preview" && !!seriesPayload);

  const dayLabel = (d: number) => t(`rentalSeries.days.${d}` as import("../../lib/i18n/keys").I18nKey);

  const togglePatternDay = (patternIndex: number, day: number) => {
    setPatterns((prev) =>
      prev.map((pattern, i) => {
        if (i !== patternIndex) return pattern;
        const days = pattern.daysOfWeek.includes(day)
          ? pattern.daysOfWeek.filter((d) => d !== day)
          : [...pattern.daysOfWeek, day].sort((a, b) => a - b);
        return { ...pattern, daysOfWeek: days };
      })
    );
  };

  const validateForm = useCallback(() => {
    if (!validFrom || !validTo || !locationId || !renterId || !tariffId) {
      toast(t("rentalSeries.fieldsInvalid"), "error");
      return false;
    }
    if (validTo < validFrom) {
      toast(t("rentalSeries.dateRangeInvalid"), "error");
      return false;
    }
    for (const pattern of patterns) {
      if (!pattern.daysOfWeek.length) {
        toast(t("rentalSeries.patternDaysRequired"), "error");
        return false;
      }
      if (timeToMinutes(pattern.timeEnd) <= timeToMinutes(pattern.timeStart)) {
        toast(t("schedule.rental.timeRangeInvalid"), "error");
        return false;
      }
    }
    return true;
  }, [validFrom, validTo, locationId, renterId, tariffId, patterns, toast, t]);

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

  const handleSubmit = async () => {
    if (!validateForm() || !seriesPayload) return;

    const preview = previewQuery.data;
    if (preview && !preview.success) {
      toast(resolveMutationError(preview.error, "rentalSeries.error.previewFailed", t), "error");
      return;
    }
    if (preview?.hasConflicts) {
      toast(t("rentalSeries.conflictBlocked"), "error");
      return;
    }

    const res = await createMutation.mutateAsync({
      ...seriesPayload,
      idempotencyKey,
    });

    if (!res.success) {
      toast(resolveMutationError(res.error, "rentalSeries.error.createFailed", t), "error");
      return;
    }

    toast(res.alreadyApplied ? t("rentalSeries.alreadyApplied") : t("rentalSeries.createSuccess"), res.alreadyApplied ? "info" : "success");
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => !createMutation.isPending && onClose()} className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs" />
          <motion.div initial={{ scale: 0.97, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0, y: 8 }} className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-lg w-full p-4 panel-card-stack max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">{t("rentalSeries.action")}</p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">{t("rentalSeries.title")}</h3>
              </div>
              <button type="button" onClick={onClose} disabled={createMutation.isPending} aria-label={t("common.close")} className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            {step === "form" ? (
              <div className="space-y-4 font-sans">
                <div className="grid grid-cols-2 gap-3">
                  <DatePickerField label={t("rentalSeries.validFromLabel")} value={validFrom} onChange={setValidFrom} required />
                  <DatePickerField label={t("rentalSeries.validToLabel")} value={validTo} onChange={setValidTo} required />
                </div>

                <AppSelect label={t("schedule.form.location")} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {locations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </AppSelect>

                <AppSelect label={t("rentalSeries.tariffLabel")} value={tariffId} onChange={(e) => setTariffId(e.target.value)}>
                  <option value="">{t("rentalSeries.selectTariff")}</option>
                  {filteredTariffs.map((tariff) => (
                    <option key={tariff.id} value={tariff.id}>{tariff.name}</option>
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
                  <input className={fieldCls} value={purpose} onChange={(e) => setPurpose(e.target.value)} />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className={labelCls}>{t("rentalSeries.patternsLabel")}</span>
                    <button type="button" onClick={() => setPatterns((prev) => [...prev, emptyPattern()])} className="text-xs font-semibold text-indigo-600 cursor-pointer">
                      {t("rentalSeries.addPattern")}
                    </button>
                  </div>
                  {patterns.map((pattern, idx) => (
                    <div key={idx} className="rounded-lg border border-slate-100 p-3 space-y-2">
                      <div className="flex flex-wrap gap-1">
                        {WEEK_DAYS.map((day) => (
                          <button
                            key={day}
                            type="button"
                            onClick={() => togglePatternDay(idx, day)}
                            className={`px-2 py-0.5 text-[10px] font-semibold rounded cursor-pointer ${
                              pattern.daysOfWeek.includes(day) ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"
                            }`}
                          >
                            {dayLabel(day)}
                          </button>
                        ))}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="time" className={fieldCls} value={pattern.timeStart} onChange={(e) => setPatterns((prev) => prev.map((p, i) => (i === idx ? { ...p, timeStart: e.target.value } : p)))} />
                        <input type="time" className={fieldCls} value={pattern.timeEnd} onChange={(e) => setPatterns((prev) => prev.map((p, i) => (i === idx ? { ...p, timeEnd: e.target.value } : p)))} />
                      </div>
                      {patterns.length > 1 ? (
                        <button type="button" onClick={() => setPatterns((prev) => prev.filter((_, i) => i !== idx))} className="text-xs text-rose-600 font-semibold cursor-pointer">
                          {t("common.delete")}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="rounded-lg border border-amber-100 bg-amber-50/60 p-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">{t("rentalSeries.previewTitle")}</p>
                  <p className="mt-1 font-semibold text-slate-800">
                    {formatDate(validFrom)} – {formatDate(validTo)}
                  </p>
                  {previewQuery.data?.success ? (
                    <p className="text-xs text-slate-600 mt-1">
                      {t("rentalSeries.occurrenceCount", { count: previewQuery.data.occurrenceCount })}
                      {canSeeFinance && previewQuery.data.totalAmount != null
                        ? ` · ${formatCurrency(previewQuery.data.totalAmount)}`
                        : ""}
                    </p>
                  ) : null}
                </div>

                {previewQuery.isLoading ? (
                  <p className="text-slate-400">{t("common.loading.default")}</p>
                ) : previewQuery.data?.success ? (
                  <div className="max-h-48 overflow-y-auto space-y-1 text-xs">
                    {previewQuery.data.occurrences.map((occ) => (
                      <div key={`${occ.occurrenceDate}-${occ.timeStart}`} className={`flex justify-between gap-2 py-1 border-b border-slate-50 ${occ.hasConflict ? "text-rose-600" : "text-slate-700"}`}>
                        <span>{formatDate(occ.occurrenceDate)} · {occ.timeStart}–{occ.timeEnd}</span>
                        <span>
                          {occ.hasConflict ? t("rentalSeries.hasConflict") : canSeeFinance && occ.calculatedAmount != null ? formatCurrency(occ.calculatedAmount) : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-rose-600 text-xs">{t("rentalSeries.error.previewFailed")}</p>
                )}

                {previewQuery.data?.hasConflicts ? (
                  <p className="text-rose-600 text-xs">{t("rentalSeries.conflictBlocked")}</p>
                ) : previewQuery.data?.success ? (
                  <p className="text-emerald-700 text-xs">{t("rentalSeries.noConflicts")}</p>
                ) : null}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button type="button" onClick={onClose} disabled={createMutation.isPending} className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer">
                {t("common.cancel")}
              </button>
              {step === "form" ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!validateForm()) return;
                    setStep("preview");
                  }}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer"
                >
                  <CalendarRange className="w-3.5 h-3.5" />
                  {t("rentalSeries.previewAction")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  disabled={createMutation.isPending || previewQuery.data?.hasConflicts || !previewQuery.data?.success}
                  className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-60"
                >
                  {createMutation.isPending ? t("common.saving") : t("rentalSeries.confirmCreate")}
                </button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
