import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Smartphone, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import {
  addCalendarDaysIso,
  isMiniAppDurationValid,
  miniAppEndOptions,
  miniAppTimeOptions,
  snapMiniAppTime,
} from "../../lib/miniAppBookingGrid";
import { formatCurrency } from "../../lib/utils";
import { useI18n } from "../../hooks/useI18n";
import { useRenters } from "../../hooks/useRenters";
import { useRentalConflictsPreview } from "../../hooks/useRentals";
import { useLocationRentalHourRates } from "../../hooks/useLocationRentalHourRates";
import {
  useRenterCreateBooking,
  useRenterCreateRecurringPack,
  useRenterQuoteBooking,
} from "../../hooks/useRenterMiniAppStaff";
import AppSelect from "../ui/AppSelect";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";
import DatePickerField from "../ui/DatePickerField";
import type { ScheduleCellPrefill } from "./AddLessonTypePopup";
import type { LocationOption } from "./CreateRentalDialog";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

interface CreateMiniAppBookingDialogProps {
  open: boolean;
  prefill?: ScheduleCellPrefill | null;
  preselectedRenterId?: string | null;
  locations: LocationOption[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateMiniAppBookingDialog({
  open,
  prefill,
  preselectedRenterId,
  locations,
  toast,
  onClose,
  onSuccess,
}: CreateMiniAppBookingDialogProps) {
  const { t } = useI18n();
  const ratesQuery = useLocationRentalHourRates(open);
  const rentersQuery = useRenters({ enabled: open, activeOnly: true });
  const quoteMutation = useRenterQuoteBooking();
  const createMutation = useRenterCreateBooking();
  const packMutation = useRenterCreateRecurringPack();

  const [mode, setMode] = useState<"one_time" | "pack">("one_time");
  const [rentalDate, setRentalDate] = useState("");
  const [timeStart, setTimeStart] = useState("12:00");
  const [timeEnd, setTimeEnd] = useState("13:00");
  const [locationId, setLocationId] = useState("");
  const [renterId, setRenterId] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [quoteLabel, setQuoteLabel] = useState<string | null>(null);

  const channelLocations = useMemo(() => {
    const fromRates = (ratesQuery.data?.locations ?? []).filter(
      (loc) => loc.miniappEnabled && loc.kindsComplete
    );
    if (fromRates.length) {
      return fromRates.map((loc) => ({ id: loc.locationId, name: loc.name }));
    }
    return locations;
  }, [ratesQuery.data?.locations, locations]);

  const rentersWithTelegram = useMemo(
    () => (rentersQuery.data ?? []).filter((r) => r.telegramId),
    [rentersQuery.data]
  );

  const startOptions = useMemo(() => miniAppTimeOptions(), []);
  const endOptions = useMemo(() => miniAppEndOptions(timeStart), [timeStart]);

  useEffect(() => {
    if (!open) return;
    const start = snapMiniAppTime(prefill?.timeStart ?? "12:00");
    const ends = miniAppEndOptions(start);
    setTimeStart(start);
    setTimeEnd(prefill?.timeEnd && isMiniAppDurationValid(start, snapMiniAppTime(prefill.timeEnd))
      ? snapMiniAppTime(prefill.timeEnd)
      : (ends[0] ?? "13:00"));
    setRentalDate(prefill?.date ?? "");
    setLocationId(prefill?.locationId ?? channelLocations[0]?.id ?? "");
    setRenterId(preselectedRenterId ?? "");
    setMode("one_time");
    setQuoteLabel(null);
    if (prefill?.date) {
      const [y, m, d] = prefill.date.split("-").map(Number);
      const dow = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1)).getUTCDay();
      const iso = dow === 0 ? 7 : dow;
      setWeekdays([iso]);
    }
  }, [open, prefill, preselectedRenterId, channelLocations]);

  const conflictsQuery = useRentalConflictsPreview(
    rentalDate,
    timeStart,
    timeEnd,
    locationId,
    open && mode === "one_time" && !!rentalDate && !!timeStart && !!timeEnd && !!locationId
  );

  const addonActive = ratesQuery.data?.addonActive ?? false;
  const pending = createMutation.isPending || packMutation.isPending || quoteMutation.isPending;

  const refreshQuote = async () => {
    if (!renterId || !locationId || !timeStart || !timeEnd) return;
    const payload =
      mode === "pack"
        ? {
            renter_id: renterId,
            location_id: locationId,
            time_start: timeStart,
            time_end: timeEnd,
            valid_from: rentalDate,
            valid_to: addCalendarDaysIso(rentalDate, 27),
            weekdays: weekdays.map(String),
          }
        : {
            renter_id: renterId,
            location_id: locationId,
            rental_date: rentalDate,
            time_start: timeStart,
            time_end: timeEnd,
          };
    const res = await quoteMutation.mutateAsync(payload);
    if (!res.success) {
      setQuoteLabel(null);
      toast(resolveMutationError(res.error, "renter.booking.quoteFailed", t), "error");
      return;
    }
    const data = res.data as Record<string, unknown>;
    if (mode === "pack") {
      const occ = Array.isArray(data.occurrences) ? data.occurrences : [];
      const busy = occ.filter((row) => (row as { busy?: boolean }).busy).length;
      setQuoteLabel(t("schedule.miniapp.packQuote", { count: occ.length, busy }));
      return;
    }
    const cost = data.cost != null ? Number(data.cost) : null;
    const currency = data.currency != null ? String(data.currency) : "RUB";
    const busy = Boolean(data.busy);
    setQuoteLabel(
      [
        cost != null ? `${formatCurrency(cost)} ${currency}` : null,
        busy ? t("schedule.miniapp.slotBusy") : t("schedule.miniapp.slotFree"),
      ]
        .filter(Boolean)
        .join(" · ")
    );
  };

  const handleSubmit = async () => {
    if (!addonActive) {
      toast(t("renter.addonInactive"), "error");
      return;
    }
    if (!renterId || !locationId || !rentalDate) {
      toast(t("schedule.rental.fieldsInvalid"), "error");
      return;
    }
    if (!isMiniAppDurationValid(timeStart, timeEnd)) {
      toast(t("renter.booking.timeInvalid"), "error");
      return;
    }

    if (mode === "one_time") {
      const conflicts = conflictsQuery.data;
      if (conflicts && !conflicts.success) {
        toast(resolveMutationError(conflicts.error, "schedule.rental.previewFailed", t), "error");
        return;
      }
      if (conflicts?.conflicts.length) {
        toast(t("schedule.rental.conflictBlocked"), "error");
        return;
      }
      const res = await createMutation.mutateAsync({
        renter_id: renterId,
        location_id: locationId,
        rental_date: rentalDate,
        time_start: timeStart,
        time_end: timeEnd,
        idempotency_key: crypto.randomUUID(),
      });
      if (!res.success) {
        toast(resolveMutationError(res.error, "renter.booking.createFailed", t), "error");
        return;
      }
    } else {
      const res = await packMutation.mutateAsync({
        renter_id: renterId,
        location_id: locationId,
        time_start: timeStart,
        time_end: timeEnd,
        valid_from: rentalDate,
        valid_to: addCalendarDaysIso(rentalDate, 27),
        weekdays: weekdays.map(String),
        idempotency_key: crypto.randomUUID(),
      });
      if (!res.success) {
        toast(resolveMutationError(res.error, "renter.booking.packFailed", t), "error");
        return;
      }
    }

    toast(t("schedule.miniapp.createSuccess"), "success");
    onSuccess();
    onClose();
  };

  return (
    <AnimatePresence>
      {open ? (
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
            className="relative w-full max-w-md bg-white rounded-xl border border-slate-200 shadow-xl max-h-[90dvh] overflow-y-auto"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <Smartphone className="w-4 h-4 text-slate-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">{t("schedule.miniapp.createTitle")}</h3>
              </div>
              <button type="button" onClick={onClose} disabled={pending} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer" aria-label={t("common.close")}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {!addonActive && ratesQuery.isFetched ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2">
                  {t("renter.addonInactive")}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("one_time")}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                    mode === "one_time" ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 text-slate-600"
                  }`}
                >
                  {t("schedule.miniapp.modeOnce")}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("pack")}
                  className={`px-3 py-2 text-xs font-semibold rounded-lg border cursor-pointer ${
                    mode === "pack" ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-slate-200 text-slate-600"
                  }`}
                >
                  {t("schedule.miniapp.modePack")}
                </button>
              </div>

              <DatePickerField
                label={mode === "pack" ? t("schedule.miniapp.packStart") : t("schedule.rental.dateLabel")}
                value={rentalDate}
                onChange={setRentalDate}
              />
              <div className="grid grid-cols-2 gap-3">
                <AppSelect label={t("common.timeStart")} value={timeStart} onChange={(e) => {
                  const next = e.target.value;
                  setTimeStart(next);
                  const ends = miniAppEndOptions(next);
                  if (!ends.includes(timeEnd)) setTimeEnd(ends[0] ?? timeEnd);
                }}>
                  {startOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </AppSelect>
                <AppSelect label={t("common.timeEnd")} value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)}>
                  {endOptions.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </AppSelect>
              </div>
              <AppSelect label={t("schedule.form.location")} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {channelLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </AppSelect>
              <AppSelect label={t("schedule.rental.renterLabel")} value={renterId} onChange={(e) => setRenterId(e.target.value)}>
                <option value="">{t("schedule.miniapp.selectRenter")}</option>
                {rentersWithTelegram.map((renter) => (
                  <option key={renter.id} value={renter.id}>{renter.displayName}</option>
                ))}
              </AppSelect>
              {rentersWithTelegram.length === 0 ? (
                <p className="text-xs text-slate-500">{t("schedule.miniapp.needTelegram")}</p>
              ) : null}

              {mode === "pack" ? (
                <div>
                  <span className={labelCls}>{t("schedule.miniapp.weekdays")}</span>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {WEEKDAYS.map((day) => (
                      <label key={day} className="inline-flex items-center gap-1 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={weekdays.includes(day)}
                          onChange={(e) => {
                            setWeekdays((prev) =>
                              e.target.checked ? [...prev, day] : prev.filter((d) => d !== day)
                            );
                          }}
                        />
                        {t(`schedule.miniapp.dow.${day}` as "schedule.miniapp.dow.1")}
                      </label>
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">{t("schedule.miniapp.packHint")}</p>
                </div>
              ) : null}

              {mode === "one_time" && conflictsQuery.data?.conflicts.length ? (
                <p className="text-xs text-rose-600">{t("schedule.rental.conflictBlocked")}</p>
              ) : null}

              {quoteLabel ? <p className="text-xs text-slate-600">{quoteLabel}</p> : null}
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <button type="button" onClick={onClose} disabled={pending} className={btnCancelCls}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void refreshQuote()}
                disabled={pending || !addonActive}
                className="px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50"
              >
                {t("schedule.miniapp.quote")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={pending || !addonActive}
                className={btnAddCls}
              >
                {pending ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
