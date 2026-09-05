import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Plus, Smartphone, X } from "lucide-react";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { parseTelegramIdInput } from "../../lib/renterNormalize";
import {
  addCalendarDaysIso,
  isMiniAppDurationValid,
  miniAppEndOptions,
  miniAppTimeOptions,
  snapMiniAppTime,
} from "../../lib/miniAppBookingGrid";
import { validFromInWeekdays, weekdaysIncludingDate } from "../../lib/packWeekdays";
import { formatCurrency } from "../../lib/utils";
import { useI18n } from "../../hooks/useI18n";
import { useUpsertRenter } from "../../hooks/useRenterCrm";
import { useRenters } from "../../hooks/useRenters";
import { useLocationRentalHourRates } from "../../hooks/useLocationRentalHourRates";
import {
  useRenterCreateBooking,
  useRenterCreateRecurringPack,
  useRenterQuoteBooking,
} from "../../hooks/useRenterMiniAppStaff";
import type { I18nKey } from "../../lib/i18n/keys";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";
import DatePickerField from "../ui/DatePickerField";
import type { ScheduleCellPrefill } from "./AddLessonTypePopup";
import type { LocationOption } from "./CreateRentalDialog";

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
const QUOTE_DEBOUNCE_MS = 300;

const REASON_I18N: Record<string, I18nKey> = {
  "renter.booking.tooSoon": "renter.booking.tooSoon",
  "renter.booking.conflict": "renter.booking.conflict",
  "renter.booking.outsideWindow": "renter.booking.outsideWindow",
  "renter.booking.packWindow": "renter.booking.packWindow",
  "renter.booking.locationUnavailable": "renter.booking.locationUnavailable",
  "renter.booking.debt": "renter.booking.debt",
  "renter.booking.inactive": "renter.booking.inactive",
  "renter.booking.banned": "renter.booking.banned",
};

type StaffQuote = {
  canCreate: boolean;
  reasons: string[];
  fingerprint: string;
  cost?: number;
  prepay?: number;
  remainder?: number;
  balance?: number | null;
  shortage?: number | null;
  currency?: string;
  occurrenceCount?: number;
  busyCount?: number;
};

interface CreateMiniAppBookingDialogProps {
  open: boolean;
  prefill?: ScheduleCellPrefill | null;
  preselectedRenterId?: string | null;
  locations: LocationOption[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

function parseQuote(data: Record<string, unknown>): StaffQuote {
  const reasons = Array.isArray(data.reasons)
    ? (data.reasons as unknown[]).map(String)
    : [];
  return {
    canCreate: Boolean(data.can_create),
    reasons,
    fingerprint: String(data.fingerprint ?? ""),
    cost: data.cost != null ? Number(data.cost) : undefined,
    prepay: data.prepay != null ? Number(data.prepay) : undefined,
    remainder: data.remainder != null ? Number(data.remainder) : undefined,
    balance: data.balance != null ? Number(data.balance) : null,
    shortage: data.shortage != null ? Number(data.shortage) : null,
    currency: data.currency != null ? String(data.currency) : "RUB",
    occurrenceCount: data.occurrence_count != null ? Number(data.occurrence_count) : undefined,
    busyCount: data.busy_count != null ? Number(data.busy_count) : undefined,
  };
}

export default function CreateMiniAppBookingDialog({
  open,
  prefill,
  preselectedRenterId,
  locations: _locations,
  toast,
  onClose,
  onSuccess,
}: CreateMiniAppBookingDialogProps) {
  const { t } = useI18n();
  const ratesQuery = useLocationRentalHourRates(open);
  const rentersQuery = useRenters({ enabled: open, activeOnly: true });
  const upsertRenterMutation = useUpsertRenter();
  const quoteMutation = useRenterQuoteBooking();
  const createMutation = useRenterCreateBooking();
  const packMutation = useRenterCreateRecurringPack();

  const idempotencyKeyRef = useRef<string | null>(null);

  const [mode, setMode] = useState<"one_time" | "pack">("one_time");
  const [rentalDate, setRentalDate] = useState("");
  const [timeStart, setTimeStart] = useState("12:00");
  const [timeEnd, setTimeEnd] = useState("13:00");
  const [locationId, setLocationId] = useState("");
  const [renterId, setRenterId] = useState("");
  const [showNewRenter, setShowNewRenter] = useState(false);
  const [newRenterName, setNewRenterName] = useState("");
  const [newRenterTelegramId, setNewRenterTelegramId] = useState("");
  const [weekdays, setWeekdays] = useState<number[]>([1]);
  const [quote, setQuote] = useState<StaffQuote | null>(null);
  const [quoting, setQuoting] = useState(false);

  const channelLocations = useMemo(() => {
    return (ratesQuery.data?.locations ?? [])
      .filter((loc) => loc.miniappEnabled && loc.kindsComplete)
      .map((loc) => ({ id: loc.locationId, name: loc.name }));
  }, [ratesQuery.data?.locations]);

  const channelReady = ratesQuery.isFetched && channelLocations.length > 0;
  const packWeekdaysValid = mode !== "pack" || validFromInWeekdays(rentalDate, weekdays);

  const rentersWithTelegram = useMemo(
    () => (rentersQuery.data ?? []).filter((r) => r.telegramId),
    [rentersQuery.data]
  );

  const startOptions = useMemo(() => miniAppTimeOptions(), []);
  const endOptions = useMemo(() => miniAppEndOptions(timeStart), [timeStart]);

  const quoteReady =
    channelReady &&
    !!renterId &&
    !!locationId &&
    !!rentalDate &&
    !!timeStart &&
    !!timeEnd &&
    isMiniAppDurationValid(timeStart, timeEnd) &&
    (mode === "one_time" || (weekdays.length > 0 && packWeekdaysValid));

  const handleCreateRenter = async () => {
    const name = newRenterName.trim();
    if (!name) {
      toast(t("schedule.rental.renterNameRequired"), "error");
      return;
    }
    const parsedTg = parseTelegramIdInput(newRenterTelegramId);
    if (!parsedTg.ok || !parsedTg.value) {
      toast(t("schedule.miniapp.telegramRequired"), "error");
      return;
    }
    const res = await upsertRenterMutation.mutateAsync({
      displayName: name,
      counterpartyType: "individual",
      telegramId: parsedTg.value,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "schedule.rental.renterCreateFailed", t), "error");
      return;
    }
    setRenterId(res.renterId);
    setShowNewRenter(false);
    setNewRenterName("");
    setNewRenterTelegramId("");
    toast(t("schedule.rental.renterCreated"), "success");
  };

  const handleRentalDateChange = (next: string) => {
    setRentalDate(next);
    if (mode === "pack" && next) {
      setWeekdays((prev) => weekdaysIncludingDate(prev, next));
    }
  };

  useEffect(() => {
    if (!open) return;
    const start = snapMiniAppTime(prefill?.timeStart ?? "12:00");
    const ends = miniAppEndOptions(start);
    setTimeStart(start);
    setTimeEnd(
      prefill?.timeEnd && isMiniAppDurationValid(start, snapMiniAppTime(prefill.timeEnd))
        ? snapMiniAppTime(prefill.timeEnd)
        : (ends[0] ?? "13:00")
    );
    setRentalDate(prefill?.date ?? "");
    setLocationId(prefill?.locationId ?? channelLocations[0]?.id ?? "");
    setRenterId(preselectedRenterId ?? "");
    setShowNewRenter(false);
    setNewRenterName("");
    setNewRenterTelegramId("");
    setMode("one_time");
    setQuote(null);
    idempotencyKeyRef.current = crypto.randomUUID();
    if (prefill?.date) {
      setWeekdays(weekdaysIncludingDate([], prefill.date));
    }
  }, [open, prefill, preselectedRenterId, channelLocations]);

  useEffect(() => {
    if (!open || !quoteReady) {
      setQuote(null);
      return;
    }

    setQuote(null);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        setQuoting(true);
        try {
          const payload =
            mode === "pack"
              ? {
                  renter_id: renterId,
                  location_id: locationId,
                  time_start: timeStart,
                  time_end: timeEnd,
                  valid_from: rentalDate,
                  valid_to: addCalendarDaysIso(rentalDate, 27),
                  weekdays: [...weekdays].sort((a, b) => a - b).map(String),
                }
              : {
                  renter_id: renterId,
                  location_id: locationId,
                  rental_date: rentalDate,
                  time_start: timeStart,
                  time_end: timeEnd,
                };
          const res = await quoteMutation.mutateAsync(payload);
          if (cancelled) return;
          if (!res.success) {
            setQuote(null);
            toast(resolveMutationError(res.error, "renter.booking.quoteFailed", t), "error");
            return;
          }
          setQuote(parseQuote(res.data as Record<string, unknown>));
        } finally {
          if (!cancelled) setQuoting(false);
        }
      })();
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteMutation stable; re-quote on form fields only
  }, [open, mode, renterId, locationId, rentalDate, timeStart, timeEnd, weekdays, quoteReady, toast, t]);

  const addonActive = ratesQuery.data?.addonActive ?? false;
  const pending = createMutation.isPending || packMutation.isPending;
  const canSave =
    channelReady &&
    addonActive &&
    quoteReady &&
    !quoting &&
    !pending &&
    quote != null &&
    quote.canCreate &&
    !!quote.fingerprint;

  const reasonLabels = quote?.reasons.map((code) => {
    const key = REASON_I18N[code];
    return key ? t(key) : code;
  });

  const handleSubmit = async () => {
    if (!canSave || !quote) {
      toast(t("schedule.miniapp.quoteStale"), "error");
      return;
    }
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
    if (mode === "pack" && !validFromInWeekdays(rentalDate, weekdays)) {
      toast(t("schedule.miniapp.packStartWeekdayMismatch"), "error");
      return;
    }

    const idempotencyKey = idempotencyKeyRef.current ?? crypto.randomUUID();

    if (mode === "one_time") {
      const res = await createMutation.mutateAsync({
        renter_id: renterId,
        location_id: locationId,
        rental_date: rentalDate,
        time_start: timeStart,
        time_end: timeEnd,
        idempotency_key: idempotencyKey,
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
        weekdays: [...weekdays].sort((a, b) => a - b).map(String),
        idempotency_key: idempotencyKey,
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

              {!channelReady && ratesQuery.isFetched ? (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg p-2">
                  {t("schedule.miniapp.noChannelLocations")}{" "}
                  <Link
                    to="/settings/hall-rent"
                    className="font-semibold text-indigo-700 underline-offset-2 hover:underline"
                  >
                    {t("schedule.miniapp.openHallRentSetup")}
                  </Link>
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
                onChange={handleRentalDateChange}
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
              {channelReady ? (
                <AppSelect label={t("schedule.form.location")} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  {channelLocations.map((loc) => (
                    <option key={loc.id} value={loc.id}>{loc.name}</option>
                  ))}
                </AppSelect>
              ) : null}
              {!showNewRenter ? (
                <div className="space-y-2">
                  <AppSelect label={t("schedule.rental.renterLabel")} value={renterId} onChange={(e) => setRenterId(e.target.value)}>
                    <option value="">{t("schedule.miniapp.selectRenter")}</option>
                    {rentersWithTelegram.map((renter) => (
                      <option key={renter.id} value={renter.id}>{renter.displayName}</option>
                    ))}
                  </AppSelect>
                  {rentersWithTelegram.length === 0 ? (
                    <p className="text-xs text-slate-500">{t("schedule.miniapp.needTelegram")}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setShowNewRenter(true)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t("schedule.rental.addRenter")}
                  </button>
                </div>
              ) : (
                <div className="space-y-2 rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                  <div>
                    <span className={labelCls}>{t("schedule.rental.newRenterName")}</span>
                    <input className={fieldCls} value={newRenterName} onChange={(e) => setNewRenterName(e.target.value)} />
                  </div>
                  <div>
                    <span className={labelCls}>{t("renters.form.telegramId")}</span>
                    <input
                      className={fieldCls}
                      value={newRenterTelegramId}
                      onChange={(e) => setNewRenterTelegramId(e.target.value)}
                      placeholder={t("renters.form.telegramIdPlaceholder")}
                      inputMode="numeric"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">{t("schedule.miniapp.needTelegram")}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCreateRenter()}
                      disabled={upsertRenterMutation.isPending}
                      className={btnAddCls}
                    >
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowNewRenter(false)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 cursor-pointer"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}

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
                  {!packWeekdaysValid ? (
                    <p className="text-xs text-rose-600 mt-1">{t("schedule.miniapp.packStartWeekdayMismatch")}</p>
                  ) : null}
                </div>
              ) : null}

              {quoting ? (
                <p className="text-xs text-slate-500">{t("schedule.miniapp.quoteLoading")}</p>
              ) : quote ? (
                <div className="space-y-1 rounded-lg border border-slate-100 bg-slate-50/80 p-2 text-xs text-slate-700">
                  {mode === "pack" && quote.occurrenceCount != null ? (
                    <p>
                      {t("schedule.miniapp.packQuoteAmounts", {
                        count: quote.occurrenceCount,
                        busy: quote.busyCount ?? 0,
                        cost: formatCurrency(quote.cost ?? 0),
                        prepay: formatCurrency(quote.prepay ?? 0),
                        currency: quote.currency ?? "RUB",
                      })}
                    </p>
                  ) : quote.cost != null ? (
                    <>
                      <p>
                        {formatCurrency(quote.cost)} {quote.currency} · {t("schedule.miniapp.prepayLabel")}{" "}
                        {formatCurrency(quote.prepay ?? 0)} {quote.currency}
                      </p>
                      <p className="text-slate-500">
                        {t("schedule.miniapp.remainderLabel")} {formatCurrency(quote.remainder ?? 0)} {quote.currency}
                      </p>
                    </>
                  ) : null}
                  {quote.balance != null ? (
                    <p className="text-slate-500">
                      {t("schedule.miniapp.balanceLabel")} {formatCurrency(quote.balance)} {quote.currency}
                    </p>
                  ) : null}
                  {quote.shortage != null && quote.shortage > 0 ? (
                    <p className="font-medium text-amber-800">
                      {t("schedule.miniapp.shortageLabel")} {formatCurrency(quote.shortage)} {quote.currency}
                    </p>
                  ) : null}
                  {!quote.canCreate && reasonLabels?.length ? (
                    <ul className="list-disc pl-4 text-rose-600">
                      {reasonLabels.map((label) => (
                        <li key={label}>{label}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : quoteReady ? (
                <p className="text-xs text-slate-500">{t("schedule.miniapp.quoteLoading")}</p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <button type="button" onClick={onClose} disabled={pending} className={btnCancelCls}>
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={!canSave}
                className={btnAddCls}
                title={!canSave && quote && !quote.canCreate ? reasonLabels?.[0] : undefined}
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
