import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Clock, X } from "lucide-react";
import { useClients, useClientDirectory } from "../../hooks/useClients";
import {
  PAYMENT_METHODS,
  getPaymentMethodLabel,
  useRecordPersonalLessonPayment,
} from "../../hooks/usePayments";
import { usePaymentFormIdempotency, usePaymentSubmitState } from "../../hooks/usePaymentFormIdempotency";
import { useArchivedPrices, usePrices } from "../../hooks/usePrices";
import { useUpdatePersonalLesson } from "../../hooks/usePersonalLessons";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../../hooks/useOnlineStatus";
import {
  bookingClientsMatchSubscription,
  formatClientName,
  formatCurrency,
  getPriceLabel,
  filterPrivateLessonTariffsForSale,
  getSubscriptionClientIds,
} from "../../lib/utils";
import {
  durationWarning,
  lessonDurationMinutes,
  tariffUnitsSnapshot,
  translateDurationWarning,
} from "../../lib/personalTariffPricing";
import type { PaymentMethod, Price, Subscription } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useI18n } from "../../hooks/useI18n";
import SellPackageModal from "../ui/SellPackageModal";
import VenueRulePaymentConfirmDialog from "../venue-costs/VenueRulePaymentConfirmDialog";
import { type VenueCostRuleStatus } from "../../hooks/useVenueCosts";

export type PersonalLessonPaymentMode = "tariff" | "outstanding" | "package";

export interface PayPersonalLessonTarget {
  lessonId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  clientId4?: string;
  clientDisplay: string;
  payerClientId?: string | null;
  priceId?: string | null;
  chargeId?: string | null;
  /** Billed amount (document total), not outstanding debt. */
  price: number;
  paidAmount?: number;
  locationId?: string | null;
  disciplineId?: string | null;
  teacherMemberId?: string | null;
  /** Pre-selected mode; omit to let the operator choose. */
  paymentMode?: PersonalLessonPaymentMode;
  /** Hide package option (e.g. opened from financial debtors). */
  hidePackage?: boolean;
}

interface PayPersonalLessonModalProps {
  lesson: PayPersonalLessonTarget | null;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

function participantIds(lesson: PayPersonalLessonTarget): string[] {
  return [lesson.clientId1, lesson.clientId2, lesson.clientId3, lesson.clientId4].filter(
    Boolean
  ) as string[];
}

function resolveTariffById(
  tariffId: string | null | undefined,
  activeTariffs: Price[],
  archivedTariffs: Price[]
): Price | undefined {
  if (!tariffId) return undefined;
  return activeTariffs.find((t) => t.id === tariffId) ?? archivedTariffs.find((t) => t.id === tariffId);
}

export default function PayPersonalLessonModal({
  lesson,
  toast,
  onClose,
  onSuccess,
}: PayPersonalLessonModalProps) {
  const { t, locale, formatDate } = useI18n();
  const { connectionState } = useOnlineStatus();
  const { data: prices = [] } = usePrices();
  const needsArchivedLookup = Boolean(
    lesson?.priceId && !prices.some((p) => p.id === lesson.priceId)
  );
  const { data: archivedPrices = [] } = useArchivedPrices(needsArchivedLookup);
  const { data: subscriptions = [] } = useSubscriptions();
  const { data: directoryClients = [] } = useClientDirectory();
  const { data: activeClients = [] } = useClients();
  const { data: disciplines = [] } = useDisciplines();
  const recordPersonalLessonPayment = useRecordPersonalLessonPayment();
  const updatePersonalLesson = useUpdatePersonalLesson();
  const paymentIdempotencyKey = usePaymentFormIdempotency(lesson != null);
  const paymentSubmit = usePaymentSubmitState();

  const [bookingPaymentMode, setBookingPaymentMode] = useState<PersonalLessonPaymentMode | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [selectedLessonTariffId, setSelectedLessonTariffId] = useState<string | "">("");
  const [payerClientId, setPayerClientId] = useState("");
  const [linkedSubscriptionId, setLinkedSubscriptionId] = useState("");
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [venueConfirmStatus, setVenueConfirmStatus] = useState<VenueCostRuleStatus | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  const billedAmount = lesson?.price ?? 0;
  const paidSoFar = lesson?.paidAmount ?? 0;
  const remainingDebt = Math.max(billedAmount - paidSoFar, 0);
  const hasPayments = paidSoFar > 0;
  const lessonPriceId = lesson?.priceId ?? null;
  const tariffModeBlocked = !lessonPriceId && hasPayments;

  const activeLessonTariffs = useMemo(
    () =>
      filterPrivateLessonTariffsForSale(prices, {
        locationId: lesson?.locationId ?? null,
        disciplineId: lesson?.disciplineId ?? null,
        teacherMemberId: lesson?.teacherMemberId ?? null,
      }),
    [prices, lesson?.locationId, lesson?.disciplineId, lesson?.teacherMemberId]
  );

  const lessonTariffs = useMemo(() => {
    if (!lesson?.priceId) return activeLessonTariffs;
    if (activeLessonTariffs.some((t) => t.id === lesson.priceId)) return activeLessonTariffs;
    const archived = archivedPrices.find((p) => p.id === lesson.priceId);
    if (archived) return [archived, ...activeLessonTariffs];
    return activeLessonTariffs;
  }, [activeLessonTariffs, archivedPrices, lesson?.priceId]);

  const clientMap = useMemo(
    () => Object.fromEntries(directoryClients.map((c) => [c.id, c])),
    [directoryClients]
  );

  const participants = useMemo(() => (lesson ? participantIds(lesson) : []), [lesson]);
  const showPayerSelect = participants.length >= 2;

  const availablePrivateSubs = useMemo(() => {
    if (!lesson) return [];
    return subscriptions.filter((sub) => {
      if (sub.category !== "private" || sub.status !== "active" || sub.lessonsLeft <= 0) {
        return false;
      }
      return bookingClientsMatchSubscription(sub, {
        clientId1: lesson.clientId1,
        clientId2: lesson.clientId2,
        clientId3: lesson.clientId3,
        clientId4: lesson.clientId4,
      });
    });
  }, [subscriptions, lesson]);

  const selectedTariff = useMemo(
    () => resolveTariffById(selectedLessonTariffId || lessonPriceId, lessonTariffs, archivedPrices),
    [selectedLessonTariffId, lessonPriceId, lessonTariffs, archivedPrices]
  );

  const lessonMinutes = lesson ? lessonDurationMinutes(lesson.timeStart, lesson.timeEnd) : 0;

  const durationWarningMessage = useMemo(() => {
    if (bookingPaymentMode !== "tariff" || !selectedTariff || lessonMinutes <= 0) return null;
    const code = durationWarning({
      lessonMinutes,
      tariffDurationMinutes: selectedTariff.durationMinutes,
    });
    if (!code) return null;
    return translateDurationWarning(code, t, selectedTariff.durationMinutes, lessonMinutes);
  }, [bookingPaymentMode, selectedTariff, lessonMinutes, t]);

  const tariffSelectLocked = hasPayments;

  const lessonId = lesson?.lessonId;

  useEffect(() => {
    paymentSubmit.reset();
    if (!lessonId || !lesson) {
      setBookingPaymentMode(null);
      return;
    }

    setLinkedSubscriptionId("");
    setPaymentMethod("cash");

    const initialMode = lesson.paymentMode ?? null;
    if (initialMode === "tariff" && tariffModeBlocked) {
      setBookingPaymentMode("outstanding");
    } else {
      setBookingPaymentMode(initialMode);
    }

    const defaultPayer = lesson.payerClientId ?? lesson.clientId1;
    setPayerClientId(
      defaultPayer && participants.includes(defaultPayer) ? defaultPayer : participants[0] ?? ""
    );

    if (lesson.priceId) {
      setSelectedLessonTariffId(lesson.priceId);
    } else {
      setSelectedLessonTariffId("");
    }

    const mode = initialMode === "tariff" && tariffModeBlocked ? "outstanding" : initialMode;
    if (mode === "outstanding") {
      setPaymentAmount(remainingDebt > 0 ? remainingDebt.toString() : "");
    } else if (mode === "tariff") {
      setPaymentAmount(remainingDebt > 0 ? remainingDebt.toString() : "");
    } else {
      setPaymentAmount("");
    }
  }, [
    lessonId,
    lesson?.paymentMode,
    lesson?.priceId,
    lesson?.payerClientId,
    lesson?.clientId1,
    lesson?.price,
    lesson?.paidAmount,
    participants,
    remainingDebt,
    tariffModeBlocked,
  ]);

  useEffect(() => {
    if (!lesson || bookingPaymentMode !== "tariff") return;
    setSelectedLessonTariffId((current) => {
      if (tariffSelectLocked && lesson.priceId) return lesson.priceId;
      if (current && lessonTariffs.some((t) => t.id === current)) return current;
      if (lesson.priceId && lessonTariffs.some((t) => t.id === lesson.priceId)) return lesson.priceId;
      return lessonTariffs[0]?.id ?? "";
    });
    setPaymentAmount(remainingDebt > 0 ? remainingDebt.toString() : "");
  }, [lesson, bookingPaymentMode, lessonTariffs, lesson?.priceId, remainingDebt, tariffSelectLocked]);

  useEffect(() => {
    if (!lesson || bookingPaymentMode !== "outstanding") return;
    setPaymentAmount(remainingDebt > 0 ? remainingDebt.toString() : "");
  }, [lesson, bookingPaymentMode, remainingDebt]);

  useEffect(() => {
    if (!lesson) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lesson, onClose]);

  const payerDisplay = useMemo(() => {
    const client = clientMap[payerClientId];
    return client ? formatClientName(client.lastName, client.firstName) : lesson?.clientDisplay ?? "";
  }, [clientMap, payerClientId, lesson?.clientDisplay]);

  const subscriptionOwnerLabel = (sub: Subscription): string =>
    getSubscriptionClientIds(sub)
      .map((id) => {
        const c = clientMap[id];
        return c ? formatClientName(c.lastName, c.firstName) : id;
      })
      .join(" & ");

  const pending =
    recordPersonalLessonPayment.isPending || updatePersonalLesson.isPending || paymentSubmit.phase === "saving";

  const validatePaymentAmount = (amount: number, maxAmount: number): string | null => {
    if (Number.isNaN(amount) || amount <= 0) return t("personal.pay.amountRequired");
    if (amount > maxAmount) return t("personal.pay.exceedsRemaining");
    return null;
  };

  const handlePayCash = async (venueRuleAcknowledged = false) => {
    if (!lesson) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (paymentSubmit.phase === "saved") return;
    if (!bookingPaymentMode || bookingPaymentMode === "package") return;

    if (showPayerSelect && !payerClientId) {
      toast(t("personalTariff.payer.required"), "error");
      return;
    }

    const amountNum = parseFloat(paymentAmount);
    const validationError = validatePaymentAmount(amountNum, remainingDebt);
    if (validationError) {
      toast(validationError, "error");
      return;
    }

    if (bookingPaymentMode === "tariff" && !selectedTariff) {
      toast(t("subscriptions.error.selectTariff"), "error");
      return;
    }

    paymentSubmit.begin();

    const payerId = payerClientId || lesson.clientId1;
    const isTariffMode = bookingPaymentMode === "tariff";

    const paymentRes = await recordPersonalLessonPayment.mutateAsync({
      lessonId: lesson.lessonId,
      clientId: payerId,
      clientDisplay: payerDisplay,
      amount: amountNum,
      method: paymentMethod,
      idempotencyKey: paymentIdempotencyKey || crypto.randomUUID(),
      venueRuleAcknowledged,
      priceId: isTariffMode ? (selectedTariff?.id ?? null) : null,
      tariffUnits:
        isTariffMode && selectedTariff?.durationMinutes != null && lessonMinutes > 0
          ? tariffUnitsSnapshot(lessonMinutes, selectedTariff.durationMinutes)
          : null,
      tariffDurationMinutes: isTariffMode ? (selectedTariff?.durationMinutes ?? null) : null,
      tariffPrice: isTariffMode ? (selectedTariff?.price ?? null) : null,
      tariffLabel: isTariffMode && selectedTariff ? getPriceLabel(selectedTariff, t, locale) : null,
      lessonDurationMinutes: isTariffMode && lessonMinutes > 0 ? lessonMinutes : null,
      chargeId: lesson.chargeId ?? null,
    });

    if (!paymentRes.success) {
      paymentSubmit.reset();
      if (
        "errorCode" in paymentRes &&
        paymentRes.errorCode === "venue_rule_ack_required" &&
        "venueRuleStatus" in paymentRes
      ) {
        setVenueConfirmStatus(paymentRes.venueRuleStatus);
        return;
      }
      toast(paymentRes.error ?? t("common.paymentChargeFailed"), "error");
      return;
    }

    paymentSubmit.complete(paymentRes.operationNumber);
    setVenueConfirmStatus(null);
    if (paymentRes.alreadyApplied) {
      toast(t("personal.pay.alreadyApplied"), "info");
    } else {
      toast(t("personal.pay.success"), "success");
    }
    onSuccess();
    onClose();
  };

  const handlePayPackage = async () => {
    if (!lesson) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!linkedSubscriptionId) {
      toast(t("common.selectPackageError"), "error");
      return;
    }

    const linkedSub = subscriptions.find((s) => s.id === linkedSubscriptionId);
    if (!linkedSub) {
      toast(t("common.packageNotFound"), "error");
      return;
    }

    const res = await updatePersonalLesson.mutateAsync({
      id: lesson.lessonId,
      subscriptionId: linkedSubscriptionId,
      price: 0,
      paid: true,
    });

    if (!res.success) {
      toast(res.error ?? t("common.chargeFailed"), "error");
      return;
    }

    toast(t("common.lessonPaidFromPackage"), "success");
    onSuccess();
    onClose();
  };

  const selectMode = (mode: PersonalLessonPaymentMode) => {
    setBookingPaymentMode(mode);
    setLinkedSubscriptionId("");
    if (mode === "tariff") {
      if (lesson?.priceId) {
        setSelectedLessonTariffId(lesson.priceId);
      } else if (lessonTariffs.length > 0) {
        setSelectedLessonTariffId(lessonTariffs[0].id!);
      }
      setPaymentAmount(remainingDebt > 0 ? remainingDebt.toString() : "");
    } else if (mode === "outstanding") {
      setPaymentAmount(remainingDebt > 0 ? remainingDebt.toString() : "");
    }
  };

  const showModePicker = lesson != null && lesson.paymentMode == null;
  const showPackageOption = lesson != null && !lesson.hidePackage;

  return (
    <>
      <AnimatePresence>
        {lesson && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-md w-full max-h-[90vh] overflow-y-auto p-4 panel-card-stack"
            >
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
                    {t("schedule.lessonInfo.payment")}
                  </p>
                  <h3 className="text-base font-semibold tracking-tight text-slate-900 break-words">
                    {lesson.clientDisplay}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={t("common.close")}
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5 shrink-0" />
                  {formatDate(lesson.date)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  {lesson.timeStart}–{lesson.timeEnd}
                </span>
              </div>

              {showModePicker && (
                <div className="field-stack">
                  <label className={labelCls}>{t("common.paymentLabel")}</label>
                  <div className={`grid gap-3 ${showPackageOption ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2"}`}>
                    {!tariffModeBlocked && (
                      <button
                        type="button"
                        onClick={() => selectMode("tariff")}
                        className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                          bookingPaymentMode === "tariff"
                            ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                            : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                        }`}
                      >
                        {t("finance.debtors.payByTariff")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => selectMode("outstanding")}
                      className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider leading-snug transition-colors cursor-pointer ${
                        bookingPaymentMode === "outstanding"
                          ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                          : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                      }`}
                    >
                      {t("finance.debtors.payOutstanding")}
                    </button>
                    {showPackageOption && (
                      <button
                        type="button"
                        onClick={() => selectMode("package")}
                        className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider leading-snug transition-colors cursor-pointer ${
                          bookingPaymentMode === "package"
                            ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                            : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                        }`}
                      >
                        {t("common.chargePackage")}
                      </button>
                    )}
                  </div>
                </div>
              )}

              {(bookingPaymentMode === "tariff" || bookingPaymentMode === "outstanding") && (
                <>
                  {billedAmount > 0 && paidSoFar > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs font-sans">
                      <span className="text-slate-500">
                        {t("personal.pay.paidSoFar")}: {formatCurrency(paidSoFar)}
                      </span>
                      <span className="text-rose-600 font-semibold">
                        {t("common.debt")}: {formatCurrency(remainingDebt)}
                      </span>
                    </div>
                  )}

                  {showPayerSelect && (
                    <AppSelect
                      label={t("personalTariff.payer.label")}
                      value={payerClientId}
                      onChange={(e) => setPayerClientId(e.target.value)}
                    >
                      {participants.map((id) => {
                        const client = clientMap[id];
                        const label = client
                          ? formatClientName(client.lastName, client.firstName)
                          : id;
                        return (
                          <option key={id} value={id}>
                            {label}
                          </option>
                        );
                      })}
                    </AppSelect>
                  )}

                  {bookingPaymentMode === "tariff" && (
                    <>
                      {lessonTariffs.length > 0 ? (
                        <AppSelect
                          label={t("common.tariffPerLesson")}
                          value={selectedLessonTariffId}
                          onChange={(e) => setSelectedLessonTariffId(e.target.value)}
                          disabled={tariffSelectLocked}
                        >
                          {lessonTariffs.map((tariff) => (
                            <option key={tariff.id} value={tariff.id!}>
                              {getPriceLabel(tariff, t, locale)} — {formatCurrency(tariff.price)}
                              {tariff.status === "archived" ? ` (${t("prices.status.archived")})` : ""}
                            </option>
                          ))}
                        </AppSelect>
                      ) : (
                        <p className="text-xs text-slate-500">{t("attendance.singleVisit.noTariffs")}</p>
                      )}
                      {tariffSelectLocked && (
                        <p className="text-[11px] text-slate-500">{t("personal.pay.tariffChangeLocked")}</p>
                      )}
                      {durationWarningMessage && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
                          {durationWarningMessage}
                        </p>
                      )}
                      <div className="field-stack">
                        <label className={labelCls}>{t("common.cost")}</label>
                        <input
                          type="number"
                          readOnly
                          value={paymentAmount}
                          className={`${fieldCls} font-semibold bg-slate-50 text-slate-700`}
                        />
                      </div>
                    </>
                  )}

                  {bookingPaymentMode === "outstanding" && (
                    <div className="field-stack">
                      <label className={labelCls}>{t("finance.debtors.outstanding")}</label>
                      <input
                        type="number"
                        placeholder="0"
                        min={0}
                        max={remainingDebt}
                        step="0.01"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        className={`${fieldCls} font-semibold`}
                      />
                    </div>
                  )}

                  <AppSelect
                    label={t("common.paymentMethod")}
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                  >
                    {PAYMENT_METHODS.map((method) => (
                      <option key={method} value={method}>
                        {getPaymentMethodLabel(method, t, locale)}
                      </option>
                    ))}
                  </AppSelect>
                  <button
                    type="button"
                    onClick={() => void handlePayCash()}
                    disabled={connectionState !== "online" || pending || remainingDebt <= 0}
                    title={translateConnectionBlockReason(connectionState, t)}
                    className={`w-full ${btnAddCls}`}
                  >
                    {paymentSubmit.phase === "saving"
                      ? t("common.saving")
                      : paymentSubmit.phase === "saved"
                        ? t("personal.pay.success")
                        : t("common.pay")}
                  </button>
                </>
              )}

              {bookingPaymentMode === "package" && (
                <>
                  {availablePrivateSubs.length === 0 ? (
                    <p className="text-xs text-slate-500 font-sans leading-relaxed">
                      {t("common.noPackages")}{" "}
                      <button
                        type="button"
                        onClick={() => setPackageModalOpen(true)}
                        className="text-indigo-600 hover:text-indigo-700 font-semibold underline-offset-2 hover:underline cursor-pointer"
                      >
                        {t("common.packageSale")}
                      </button>
                      .
                    </p>
                  ) : (
                    <AppSelect
                      label={t("common.package")}
                      value={linkedSubscriptionId}
                      onChange={(e) => setLinkedSubscriptionId(e.target.value)}
                    >
                      <option value="">{t("common.selectPackage")}</option>
                      {availablePrivateSubs.map((sub) => (
                        <option key={sub.id} value={sub.id}>
                          {subscriptionOwnerLabel(sub)} — {t("common.remaining")} {sub.lessonsLeft}
                        </option>
                      ))}
                    </AppSelect>
                  )}
                  <button
                    type="button"
                    onClick={handlePayPackage}
                    disabled={
                      connectionState !== "online" ||
                      pending ||
                      availablePrivateSubs.length === 0 ||
                      !linkedSubscriptionId
                    }
                    title={translateConnectionBlockReason(connectionState, t)}
                    className={`w-full ${btnAddCls}`}
                  >
                    {t("common.chargePackage")}
                  </button>
                </>
              )}

              {bookingPaymentMode === null && showModePicker ? (
                <p className="text-xs text-slate-400 text-center py-2">{t("common.selectPaymentMethod")}</p>
              ) : null}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <SellPackageModal
        open={packageModalOpen}
        onClose={() => setPackageModalOpen(false)}
        toast={toast}
        clients={activeClients}
        disciplines={disciplines}
        prices={prices}
        stackLayer="above"
      />
      <VenueRulePaymentConfirmDialog
        status={venueConfirmStatus}
        pending={recordPersonalLessonPayment.isPending}
        onConfirm={() => void handlePayCash(true)}
        onCancel={() => setVenueConfirmStatus(null)}
      />
    </>
  );
}
