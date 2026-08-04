import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, Clock, X } from "lucide-react";
import { useClients, useClientDirectory } from "../../hooks/useClients";
import { useRecordPersonalLessonPayment } from "../../hooks/usePayments";
import { usePaymentFormIdempotency, usePaymentSubmitState } from "../../hooks/usePaymentFormIdempotency";
import { formatOperationNumber } from "../../lib/paymentCorrection";
import { usePrices } from "../../hooks/usePrices";
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
import type { Subscription } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import { btnAddCls } from "../ui/buttonStyles";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useI18n } from "../../hooks/useI18n";
import SellPackageModal from "../ui/SellPackageModal";
import VenueRulePaymentConfirmDialog from "../venue-costs/VenueRulePaymentConfirmDialog";
import {
  type VenueCostRuleStatus,
} from "../../hooks/useVenueCosts";

export interface PayPersonalLessonTarget {
  lessonId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  clientDisplay: string;
  price: number;
  paidAmount?: number;
  locationId?: string | null;
  disciplineId?: string | null;
}

interface PayPersonalLessonModalProps {
  lesson: PayPersonalLessonTarget | null;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function PayPersonalLessonModal({
  lesson,
  toast,
  onClose,
  onSuccess,
}: PayPersonalLessonModalProps) {
  const { t, formatDate } = useI18n();
  const { connectionState } = useOnlineStatus();
  const { data: prices = [] } = usePrices();
  const { data: subscriptions = [] } = useSubscriptions();
  const { data: directoryClients = [] } = useClientDirectory();
  const { data: activeClients = [] } = useClients();
  const { data: disciplines = [] } = useDisciplines();
  const recordPersonalLessonPayment = useRecordPersonalLessonPayment();
  const updatePersonalLesson = useUpdatePersonalLesson();
  const paymentIdempotencyKey = usePaymentFormIdempotency(lesson != null);
  const paymentSubmit = usePaymentSubmitState();

  const [bookingPaymentMode, setBookingPaymentMode] = useState<"single" | "package" | null>(null);
  const [customPrice, setCustomPrice] = useState("");
  const [selectedLessonTariffId, setSelectedLessonTariffId] = useState<string | "">("");
  const [linkedSubscriptionId, setLinkedSubscriptionId] = useState("");
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [venueConfirmStatus, setVenueConfirmStatus] = useState<VenueCostRuleStatus | null>(null);

  const lessonTariffs = useMemo(
    () =>
      filterPrivateLessonTariffsForSale(prices, {
        locationId: lesson?.locationId ?? null,
        disciplineId: lesson?.disciplineId ?? null,
      }),
    [prices, lesson?.locationId, lesson?.disciplineId]
  );

  const clientMap = useMemo(
    () => Object.fromEntries(directoryClients.map((c) => [c.id, c])),
    [directoryClients]
  );

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
      });
    });
  }, [subscriptions, lesson]);

  const lessonId = lesson?.lessonId;

  useEffect(() => {
    if (!lessonId || !lesson) {
      setBookingPaymentMode(null);
      return;
    }
    setBookingPaymentMode(null);
    setLinkedSubscriptionId("");
    const remainingDebt = Math.max(lesson.price - (lesson.paidAmount ?? 0), 0);
    const initialPrice = lesson.price > 0 ? remainingDebt.toString() : "";
    setCustomPrice(initialPrice);
    setSelectedLessonTariffId("");
  }, [lessonId, lesson?.price, lesson?.paidAmount]);

  useEffect(() => {
    if (!lesson || lessonTariffs.length === 0) return;
    setSelectedLessonTariffId((current) => {
      if (current && lessonTariffs.some((t) => t.id === current)) return current;
      const matched = lessonTariffs.find((t) => t.price === lesson.price) ?? lessonTariffs[0];
      return matched.id!;
    });
    setCustomPrice((prev) => {
      if (prev) return prev;
      const matched = lessonTariffs.find((t) => t.price === lesson.price) ?? lessonTariffs[0];
      return matched.price.toString();
    });
  }, [lesson, lessonTariffs]);

  useEffect(() => {
    if (!lesson) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lesson, onClose]);

  const applyLessonTariff = (tariffId: string) => {
    const tariff = lessonTariffs.find((t) => t.id === tariffId);
    if (!tariff) return;
    setSelectedLessonTariffId(tariffId);
    setCustomPrice(tariff.price.toString());
  };

  const subscriptionOwnerLabel = (sub: Subscription): string =>
    getSubscriptionClientIds(sub)
      .map((id) => {
        const c = clientMap[id];
        return c ? formatClientName(c.lastName, c.firstName) : id;
      })
      .join(" & ");

  const pending = recordPersonalLessonPayment.isPending || updatePersonalLesson.isPending || paymentSubmit.phase === "saving";

  const handlePaySingle = async (venueRuleAcknowledged = false) => {
    if (!lesson) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (paymentSubmit.phase === "saved") return;

    const priceNum = parseFloat(customPrice);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      toast(t("common.invalidLessonCost"), "error");
      return;
    }

    paymentSubmit.begin();
    const paymentRes = await recordPersonalLessonPayment.mutateAsync({
      lessonId: lesson.lessonId,
      clientId: lesson.clientId1,
      clientDisplay: lesson.clientDisplay,
      amount: priceNum,
      method: "cash",
      idempotencyKey: paymentIdempotencyKey || crypto.randomUUID(),
      venueRuleAcknowledged,
    });

    if (!paymentRes.success) {
      paymentSubmit.reset();
      if ("errorCode" in paymentRes && paymentRes.errorCode === "venue_rule_ack_required") {
        setVenueConfirmStatus(paymentRes.venueRuleStatus);
        return;
      }
      toast(paymentRes.error ?? t("common.paymentChargeFailed"), "error");
      return;
    }

    paymentSubmit.complete(paymentRes.operationNumber);
    setVenueConfirmStatus(null);
    if (paymentRes.alreadyApplied) {
      toast(t("corrections.payment.alreadyApplied"), "info");
    } else {
      toast(
        paymentRes.operationNumber
          ? t("corrections.payment.saved", { op: formatOperationNumber(paymentRes.operationNumber) })
          : t("common.paymentRecorded"),
        "success"
      );
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

              <div className="field-stack">
                <label className={labelCls}>{t("common.paymentMethod")}</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setBookingPaymentMode("single");
                      setLinkedSubscriptionId("");
                      if (lessonTariffs.length > 0) {
                        const tariffId = selectedLessonTariffId || lessonTariffs[0].id!;
                        applyLessonTariff(tariffId);
                      }
                    }}
                    className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                      bookingPaymentMode === "single"
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                        : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                    }`}
                  >
                    {t("common.singleLessonOption")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBookingPaymentMode("package");
                      setLinkedSubscriptionId("");
                    }}
                    className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider leading-snug transition-colors cursor-pointer ${
                      bookingPaymentMode === "package"
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                        : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                    }`}
                  >
                    {t("common.chargePackage")}
                  </button>
                </div>
              </div>

              {bookingPaymentMode === "single" && (
                <>
                  {lesson.price > 0 && (lesson.paidAmount ?? 0) > 0 && (
                    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs font-sans">
                      <span className="text-slate-500">
                        {t("personal.pay.paidSoFar")}: {formatCurrency(lesson.paidAmount ?? 0)}
                      </span>
                      <span className="text-rose-600 font-semibold">
                        {t("common.debt")}: {formatCurrency(Math.max(lesson.price - (lesson.paidAmount ?? 0), 0))}
                      </span>
                    </div>
                  )}
                  {lessonTariffs.length > 0 && (
                    <div className="flex flex-nowrap items-end gap-3 w-full">
                      <div className="min-w-0 flex-1">
                        <AppSelect
                          label={t("common.tariffPerLesson")}
                          value={selectedLessonTariffId}
                          onChange={(e) => {
                            const id = e.target.value;
                            if (id) applyLessonTariff(id);
                          }}
                        >
                          {lessonTariffs.map((tariff) => (
                            <option key={tariff.id} value={tariff.id!}>
                              {getPriceLabel(tariff)} — {formatCurrency(tariff.price)}
                            </option>
                          ))}
                        </AppSelect>
                      </div>
                      <div className="field-stack w-[7.5rem] shrink-0">
                        <label className={labelCls}>{t("common.cost")}</label>
                        <input
                          type="number"
                          placeholder="0"
                          value={customPrice}
                          onChange={(e) => setCustomPrice(e.target.value)}
                          className={`${fieldCls} font-semibold`}
                        />
                      </div>
                    </div>
                  )}
                  {lessonTariffs.length === 0 && (
                    <div className="field-stack">
                      <label className={labelCls}>{t("common.cost")}</label>
                      <input
                        type="number"
                        placeholder="0"
                        value={customPrice}
                        onChange={(e) => setCustomPrice(e.target.value)}
                        className={`${fieldCls} font-semibold`}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => void handlePaySingle()}
                    disabled={connectionState !== "online" || pending}
                    title={translateConnectionBlockReason(connectionState, t)}
                    className={`w-full ${btnAddCls}`}
                  >
                    {paymentSubmit.phase === "saving"
                      ? t("common.saving")
                      : paymentSubmit.phase === "saved"
                        ? t("corrections.payment.saved", {
                            op: formatOperationNumber(paymentSubmit.operationNumber),
                          })
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

              {bookingPaymentMode === null ? (
                <p className="text-xs text-slate-400 text-center py-2">
                  {t("common.selectPaymentMethod")}
                </p>
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
        onConfirm={() => void handlePaySingle(true)}
        onCancel={() => setVenueConfirmStatus(null)}
      />
    </>
  );
}
