import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Clock, X } from "lucide-react";
import { useClients, useClientDirectory } from "../../hooks/useClients";
import {
  PAYMENT_METHODS,
  getPaymentMethodLabel,
  usePersonalLessonPayments,
  useRecordPersonalLessonPayment,
} from "../../hooks/usePayments";
import { usePaymentFormIdempotency, usePaymentSubmitState } from "../../hooks/usePaymentFormIdempotency";
import { useFinancePeriodGate } from "../../hooks/useFinancePeriodGate";
import { useArchivedPrices, usePrices } from "../../hooks/usePrices";
import { useUpdatePersonalLesson } from "../../hooks/usePersonalLessons";
import { usePersonalLessonChargeBalances } from "../../hooks/usePersonalLessonCharges";
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
  getPrivateTariffOptionLabel,
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
import PersonalLessonDebtBreakdown from "./PersonalLessonDebtBreakdown";

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
  const { data: archivedPrices = [], isFetched: archivedPricesFetched } =
    useArchivedPrices(needsArchivedLookup);
  const { data: subscriptions = [] } = useSubscriptions();
  const { data: directoryClients = [] } = useClientDirectory();
  const { data: activeClients = [] } = useClients();
  const { data: disciplines = [] } = useDisciplines();
  const recordPersonalLessonPayment = useRecordPersonalLessonPayment();
  const updatePersonalLesson = useUpdatePersonalLesson();
  const financePeriod = useFinancePeriodGate(lesson?.date);
  const paymentIdempotencyKey = usePaymentFormIdempotency(lesson != null);
  const paymentSubmit = usePaymentSubmitState();
  const chargePaymentIdempotencyKeys = useRef<Record<string, string>>({});

  const getChargePaymentIdempotencyKey = (chargeKey: string): string => {
    const existing = chargePaymentIdempotencyKeys.current[chargeKey];
    if (existing) return existing;
    const key = crypto.randomUUID();
    chargePaymentIdempotencyKeys.current[chargeKey] = key;
    return key;
  };

  const [bookingPaymentMode, setBookingPaymentMode] = useState<PersonalLessonPaymentMode | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [selectedLessonTariffId, setSelectedLessonTariffId] = useState<string | "">("");
  const [payerClientId, setPayerClientId] = useState("");
  const [linkedSubscriptionId, setLinkedSubscriptionId] = useState("");
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [venueConfirmStatus, setVenueConfirmStatus] = useState<VenueCostRuleStatus | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [payAllParticipants, setPayAllParticipants] = useState(false);

  const lessonId = lesson?.lessonId;
  const { data: chargeBalances = [], refetch: refetchCharges } = usePersonalLessonChargeBalances(
    lessonId ? [lessonId] : [],
    {
      enabled: Boolean(lessonId),
    }
  );
  const { data: lessonPayments = [] } = usePersonalLessonPayments(lessonId, {
    enabled: Boolean(lessonId),
  });

  const participants = useMemo(() => (lesson ? participantIds(lesson) : []), [lesson]);

  const lessonCharges = useMemo(() => {
    if (!lesson) return [];
    if (chargeBalances.length > 0) {
      return chargeBalances
        .filter((c) => participants.includes(c.clientId))
        .sort((a, b) => participants.indexOf(a.clientId) - participants.indexOf(b.clientId));
    }
    const payer = lesson.payerClientId ?? lesson.clientId1;
    const paid = lesson.paidAmount ?? 0;
    const billed = lesson.price ?? 0;
    return [
      {
        id: lesson.chargeId ?? "",
        personalLessonId: lesson.lessonId,
        clientId: payer,
        billedAmount: billed,
        paidAmount: paid,
        remainingAmount: Math.max(billed - paid, 0),
      },
    ];
  }, [chargeBalances, lesson, participants]);

  const unpaidCharges = useMemo(
    () => lessonCharges.filter((c) => c.remainingAmount > 0),
    [lessonCharges]
  );

  const hasMultipleUnpaidCharges = unpaidCharges.length > 1;

  const selectedCharge = useMemo(() => {
    const byPayer = lessonCharges.find((c) => c.clientId === payerClientId);
    if (byPayer) return byPayer;
    if (lesson?.chargeId) {
      const byId = lessonCharges.find((c) => c.id === lesson.chargeId);
      if (byId) return byId;
    }
    return unpaidCharges[0] ?? lessonCharges[0] ?? null;
  }, [lessonCharges, payerClientId, lesson?.chargeId, unpaidCharges]);

  const activeLessonTariffs = useMemo(
    () =>
      filterPrivateLessonTariffsForSale(prices, {
        locationId: lesson?.locationId ?? null,
        disciplineId: lesson?.disciplineId ?? null,
        teacherMemberId: lesson?.teacherMemberId ?? null,
      }),
    [prices, lesson?.locationId, lesson?.disciplineId, lesson?.teacherMemberId]
  );

  const bookedTariff = useMemo(() => {
    if (!lesson?.priceId) return undefined;
    return (
      prices.find((p) => p.id === lesson.priceId) ??
      archivedPrices.find((p) => p.id === lesson.priceId)
    );
  }, [lesson?.priceId, prices, archivedPrices]);

  const tariffBilledAmount = bookedTariff?.price ?? lesson?.price ?? 0;
  const billedAmount =
    (selectedCharge?.billedAmount ?? 0) > 0 ? selectedCharge!.billedAmount : tariffBilledAmount;
  const remainingDebt =
    selectedCharge?.remainingAmount ?? Math.max(billedAmount - (lesson?.paidAmount ?? 0), 0);
  const paidSoFar =
    (selectedCharge?.billedAmount ?? 0) > 0
      ? (selectedCharge?.paidAmount ?? lesson?.paidAmount ?? 0)
      : Math.max(billedAmount - remainingDebt, 0);
  const totalBilledAll = lessonCharges.reduce(
    (sum, charge) => sum + ((charge.billedAmount > 0 ? charge.billedAmount : tariffBilledAmount)),
    0
  );
  const totalPaidAll = lessonCharges.reduce((sum, charge) => sum + charge.paidAmount, 0);
  const totalRemainingAll = unpaidCharges.reduce((sum, c) => sum + c.remainingAmount, 0);
  const hasPayments = lessonCharges.some((c) => c.paidAmount > 0);
  const lessonPriceId = lesson?.priceId ?? null;
  const tariffModeBlocked = !lessonPriceId && hasPayments;

  const lessonTariffs = useMemo(() => {
    const base = activeLessonTariffs;
    if (!lesson?.priceId || !bookedTariff) return base;
    if (base.some((t) => t.id === lesson.priceId)) return base;
    return [bookedTariff, ...base];
  }, [activeLessonTariffs, lesson?.priceId, bookedTariff]);

  const clientMap = useMemo(
    () => Object.fromEntries(directoryClients.map((c) => [c.id, c])),
    [directoryClients]
  );

  const showPayerSelect = participants.length >= 2 && !hasMultipleUnpaidCharges;

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

  useEffect(() => {
    paymentSubmit.reset();
    chargePaymentIdempotencyKeys.current = {};
    if (!lessonId || !lesson) {
      setBookingPaymentMode(null);
      return;
    }

    setLinkedSubscriptionId("");
    setPaymentMethod("cash");
    setPayAllParticipants(false);

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
      if (lesson.priceId) {
        if (current === lesson.priceId) return current;
        if (lessonTariffs.some((t) => t.id === lesson.priceId)) return lesson.priceId;
        if (bookedTariff) return lesson.priceId;
        if (needsArchivedLookup && !archivedPricesFetched) return lesson.priceId;
        return lesson.priceId;
      }
      if (current && lessonTariffs.some((t) => t.id === current)) return current;
      return lessonTariffs[0]?.id ?? "";
    });
    setPaymentAmount(remainingDebt > 0 ? remainingDebt.toString() : "");
  }, [
    lesson,
    bookingPaymentMode,
    lessonTariffs,
    lesson?.priceId,
    remainingDebt,
    tariffSelectLocked,
    bookedTariff,
    needsArchivedLookup,
    archivedPricesFetched,
  ]);

  useEffect(() => {
    if (!lesson || bookingPaymentMode !== "outstanding") return;
    if (payAllParticipants) {
      setPaymentAmount(totalRemainingAll > 0 ? totalRemainingAll.toString() : "");
      return;
    }
    setPaymentAmount(remainingDebt > 0 ? remainingDebt.toString() : "");
  }, [lesson, bookingPaymentMode, remainingDebt, payAllParticipants, totalRemainingAll]);

  useEffect(() => {
    if (!lesson || payAllParticipants) return;
    const charge = lessonCharges.find((c) => c.clientId === payerClientId);
    if (!charge) return;
    if (bookingPaymentMode === "outstanding" || bookingPaymentMode === "tariff") {
      setPaymentAmount(charge.remainingAmount > 0 ? charge.remainingAmount.toString() : "");
    }
  }, [payerClientId, lessonCharges, bookingPaymentMode, payAllParticipants, lesson]);

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
    if (financePeriod.isClosed) {
      toast(t("finance.error.periodClosed"), "error");
      return;
    }
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (paymentSubmit.phase === "saved") return;
    if (!bookingPaymentMode || bookingPaymentMode === "package") return;

    const chargesToPay = payAllParticipants
      ? unpaidCharges
      : selectedCharge
        ? [selectedCharge]
        : [];

    if (chargesToPay.length === 0) {
      toast(t("personal.pay.amountRequired"), "error");
      return;
    }

    if (!payAllParticipants && showPayerSelect && !payerClientId) {
      toast(t("personalTariff.payer.required"), "error");
      return;
    }

    if (bookingPaymentMode === "tariff" && !selectedTariff) {
      toast(t("subscriptions.error.selectTariff"), "error");
      return;
    }

    const isTariffMode = bookingPaymentMode === "tariff";

    if (!payAllParticipants) {
      const amountNum = parseFloat(paymentAmount);
      const validationError = validatePaymentAmount(amountNum, remainingDebt);
      if (validationError) {
        toast(validationError, "error");
        return;
      }
    }

    paymentSubmit.begin();
    let paymentSucceeded = false;
    let paidCount = 0;
    const totalToPay = chargesToPay.length;
    const singlePaymentIdempotencyKey = paymentIdempotencyKey || crypto.randomUUID();

    const notifyPayAllPartial = async () => {
      toast(t("personal.pay.partialAll", { paid: paidCount, total: totalToPay }), "error");
      await refetchCharges();
    };

    try {
      for (let i = 0; i < chargesToPay.length; i++) {
        const charge = chargesToPay[i];
        const payerId = charge.clientId;
        const client = clientMap[payerId];
        const display = client
          ? formatClientName(client.lastName, client.firstName)
          : lesson.clientDisplay;
        const amountNum = payAllParticipants ? charge.remainingAmount : parseFloat(paymentAmount);

        if (Number.isNaN(amountNum) || amountNum <= 0) {
          if (payAllParticipants && paidCount > 0) {
            await notifyPayAllPartial();
          } else {
            toast(t("personal.pay.amountRequired"), "error");
          }
          return;
        }

        const paymentRes = await recordPersonalLessonPayment.mutateAsync({
          lessonId: lesson.lessonId,
          clientId: payerId,
          clientDisplay: display,
          amount: amountNum,
          method: paymentMethod,
          idempotencyKey: payAllParticipants
            ? getChargePaymentIdempotencyKey(charge.id || charge.clientId)
            : singlePaymentIdempotencyKey,
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
          chargeId: charge.id || null,
        });

        if (!paymentRes.success) {
          if (
            "errorCode" in paymentRes &&
            paymentRes.errorCode === "venue_rule_ack_required" &&
            "venueRuleStatus" in paymentRes
          ) {
            if (payAllParticipants && paidCount > 0) {
              await notifyPayAllPartial();
            }
            setVenueConfirmStatus(paymentRes.venueRuleStatus);
            return;
          }
          if (payAllParticipants && paidCount > 0) {
            await notifyPayAllPartial();
          } else {
            toast(paymentRes.error ?? t("common.paymentChargeFailed"), "error");
          }
          return;
        }
        paidCount += 1;
      }

      paymentSubmit.complete(undefined);
      setVenueConfirmStatus(null);
      toast(t("personal.pay.success"), "success");
      onSuccess();
      onClose();
      paymentSucceeded = true;
    } catch (err) {
      if (payAllParticipants && paidCount > 0) {
        await notifyPayAllPartial();
        return;
      }
      throw err;
    } finally {
      if (!paymentSucceeded) {
        paymentSubmit.reset();
      }
    }
  };

  const handlePayPackage = async () => {
    try {
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
    } catch {
      toast(t("common.chargeFailed"), "error");
    }
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
                  <PersonalLessonDebtBreakdown
                    billedAmount={totalBilledAll || billedAmount}
                    paidAmount={totalPaidAll || paidSoFar}
                    remainingAmount={Math.max(
                      (totalBilledAll || billedAmount) - (totalPaidAll || paidSoFar),
                      0
                    )}
                    tariffLabel={
                      selectedTariff
                        ? getPriceLabel(selectedTariff, t, locale)
                        : bookedTariff
                          ? getPriceLabel(bookedTariff, t, locale)
                          : null
                    }
                    payments={lessonPayments}
                  />

                  {hasMultipleUnpaidCharges && (
                    <div className="field-stack">
                      <label className={labelCls}>{t("personal.pay.chargeSplit")}</label>
                      <ul className="rounded-lg border border-slate-100 divide-y divide-slate-100 overflow-hidden">
                        {lessonCharges.map((charge) => {
                          const client = clientMap[charge.clientId];
                          const name = client
                            ? formatClientName(client.lastName, client.firstName)
                            : charge.clientId;
                          const isSelected =
                            !payAllParticipants && charge.clientId === payerClientId;
                          return (
                            <li key={charge.id || charge.clientId}>
                              <button
                                type="button"
                                disabled={charge.remainingAmount <= 0}
                                onClick={() => {
                                  setPayAllParticipants(false);
                                  setPayerClientId(charge.clientId);
                                  setPaymentAmount(
                                    charge.remainingAmount > 0
                                      ? charge.remainingAmount.toString()
                                      : ""
                                  );
                                }}
                                className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left text-xs font-sans transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                                  isSelected ? "bg-indigo-50 text-indigo-900" : "hover:bg-slate-50"
                                }`}
                              >
                                <span className="font-medium truncate">{name}</span>
                                <span
                                  className={`shrink-0 font-semibold ${
                                    charge.remainingAmount > 0 ? "text-rose-700" : "text-slate-400"
                                  }`}
                                >
                                  {formatCurrency(charge.remainingAmount)}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      <label className="flex items-center gap-2 text-xs text-slate-600 font-sans cursor-pointer">
                        <input
                          type="checkbox"
                          checked={payAllParticipants}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setPayAllParticipants(checked);
                            if (checked) {
                              setPaymentAmount(
                                totalRemainingAll > 0 ? totalRemainingAll.toString() : ""
                              );
                            } else {
                              const charge = lessonCharges.find((c) => c.clientId === payerClientId);
                              setPaymentAmount(
                                charge && charge.remainingAmount > 0
                                  ? charge.remainingAmount.toString()
                                  : ""
                              );
                            }
                          }}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        {t("personal.pay.payAllParticipants")}
                      </label>
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
                              {getPrivateTariffOptionLabel(tariff, t, locale)}
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
                        max={payAllParticipants ? totalRemainingAll : remainingDebt}
                        step="0.01"
                        value={paymentAmount}
                        onChange={(e) => setPaymentAmount(e.target.value)}
                        readOnly={payAllParticipants}
                        className={`${fieldCls} font-semibold${payAllParticipants ? " bg-slate-50 text-slate-700" : ""}`}
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
                    disabled={
                      connectionState !== "online" ||
                      pending ||
                      (payAllParticipants ? totalRemainingAll <= 0 : remainingDebt <= 0)
                    }
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
                    onClick={() => void handlePayPackage()}
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
        stackLayer="above"
        onConfirm={() => void handlePayCash(true)}
        onCancel={() => setVenueConfirmStatus(null)}
      />
    </>
  );
}
