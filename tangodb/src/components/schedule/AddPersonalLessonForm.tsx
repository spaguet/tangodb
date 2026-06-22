import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CalendarDays, MapPin, Trash2, X } from "lucide-react";
import { useClients, useClientDirectory } from "../../hooks/useClients";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useAddPersonalLessons } from "../../hooks/usePersonalLessons";
import { useRecordPersonalLessonPayment } from "../../hooks/usePayments";
import { usePrices } from "../../hooks/usePrices";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { useOrganization } from "../../organization/OrganizationProvider";
import { usePermissions } from "../../hooks/usePermissions";
import { memberDisplayName, memberListLabel, type TeamMemberRow } from "../../hooks/useTeamMembers";
import {
  getConnectionBlockReason,
  getMutationBlockedMessage,
  useOnlineStatus,
} from "../../hooks/useOnlineStatus";
import { findScheduleConflict } from "../../lib/scheduleConflicts";
import { computeAutoTimeEnd, validateTimeRange } from "../../lib/scheduleTime";
import {
  bookingClientsMatchSubscription,
  formatClientName,
  formatCurrency,
  formatDateRu,
  getPriceLabel,
  getPrivateLessonTariffs,
  getSubscriptionClientIds,
} from "../../lib/utils";
import type { Client, Subscription } from "../../types";
import AppSelect from "../ui/AppSelect";
import ClientAutocomplete from "../ui/ClientAutocomplete";
import DisciplineSelect from "../ui/DisciplineSelect";
import TimeSelect from "../ui/TimeSelect";
import type { ScheduleCellPrefill } from "./AddLessonTypePopup";

interface AddPersonalLessonFormProps {
  prefill: ScheduleCellPrefill | null;
  teacherOptions: TeamMemberRow[];
  scheduleSlots: Array<{
    id?: string;
    dayOfWeek: number;
    time: string;
    timeEnd: string;
    locationId?: string | null;
    validFrom?: string;
    validTo?: string | null;
  }>;
  personalLessons: Array<{
    id: string;
    date: string;
    timeStart: string;
    timeEnd: string;
    locationId?: string | null;
  }>;
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onClose: () => void;
  onSuccess: () => void;
}

interface BookingClientField {
  query: string;
  id: string;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function AddPersonalLessonForm({
  prefill,
  teacherOptions,
  scheduleSlots,
  personalLessons,
  toast,
  onClose,
  onSuccess,
}: AddPersonalLessonFormProps) {
  const { memberId } = useOrganization();
  const { role } = usePermissions();
  const { connectionState } = useOnlineStatus();
  const { data: activeClients = [] } = useClients();
  const { data: directoryClients = [] } = useClientDirectory();
  const { data: disciplines = [] } = useDisciplines();
  const { data: prices = [] } = usePrices();
  const { data: subscriptions = [] } = useSubscriptions();
  const addPersonalLessons = useAddPersonalLessons();
  const recordPersonalLessonPayment = useRecordPersonalLessonPayment();

  const isTeacher = role === "teacher";

  const [bookingClients, setBookingClients] = useState<BookingClientField[]>([{ query: "", id: "" }]);
  const [timeStart, setTimeStart] = useState("14:00");
  const [timeEnd, setTimeEnd] = useState("15:00");
  const [customPrice, setCustomPrice] = useState("");
  const [selectedLessonTariffId, setSelectedLessonTariffId] = useState<string | "">("");
  const [linkedSubscriptionId, setLinkedSubscriptionId] = useState("");
  const [disciplineId, setDisciplineId] = useState<string>("");
  const [teacherMemberId, setTeacherMemberId] = useState("");
  const [bookingPaymentMode, setBookingPaymentMode] = useState<"single" | "package" | null>(null);

  const lessonTariffs = getPrivateLessonTariffs(prices);
  const pType: "solo" | "pair" | "trio" =
    bookingClients.length >= 3 ? "trio" : bookingClients.length === 2 ? "pair" : "solo";

  const clientMap = useMemo(
    () => Object.fromEntries(directoryClients.map((c) => [c.id, c])),
    [directoryClients]
  );

  const availablePrivateSubs = subscriptions.filter(
    (s) => s.category === "private" && s.status === "active" && s.lessonsLeft > 0
  );

  const packageLocked = bookingPaymentMode === "package" && !!linkedSubscriptionId;

  useEffect(() => {
    if (!prefill) return;
    setBookingClients([{ query: "", id: "" }]);
    setTimeStart(prefill.timeStart);
    setTimeEnd(computeAutoTimeEnd(prefill.timeStart, []));
    setCustomPrice("");
    setLinkedSubscriptionId("");
    setBookingPaymentMode(null);
    if (disciplines.length > 0) setDisciplineId(disciplines[0].id);
    if (isTeacher && memberId) {
      setTeacherMemberId(memberId);
    } else if (teacherOptions.length > 0) {
      setTeacherMemberId(teacherOptions[0].id);
    }
  }, [prefill, disciplines, teacherOptions, isTeacher, memberId]);

  useEffect(() => {
    if (lessonTariffs.length > 0 && selectedLessonTariffId === "") {
      const first = lessonTariffs[0];
      setSelectedLessonTariffId(first.id!);
      setCustomPrice(first.price.toString());
    }
  }, [lessonTariffs, selectedLessonTariffId]);

  useEffect(() => {
    if (!prefill) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefill, onClose]);

  const sameDayLessons = useMemo(() => {
    if (!prefill) return [];
    return personalLessons
      .filter((l) => l.date === prefill.date && l.locationId === prefill.locationId)
      .map((l) => ({ timeStart: l.timeStart, timeEnd: l.timeEnd }));
  }, [prefill, personalLessons]);

  const handleTimeStartChange = (next: string) => {
    setTimeStart(next);
    setTimeEnd(computeAutoTimeEnd(next, sameDayLessons));
  };

  const applyLessonTariff = (tariffId: string) => {
    const tariff = lessonTariffs.find((t) => t.id === tariffId);
    if (!tariff) return;
    setSelectedLessonTariffId(tariffId);
    setCustomPrice(tariff.price.toString());
  };

  const applySubscriptionToBooking = (subId: string) => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return;
    const fields: BookingClientField[] = getSubscriptionClientIds(sub).map((id) => {
      const c = clientMap[id];
      return { id, query: c ? formatClientName(c.lastName, c.firstName) : id };
    });
    if (fields.length === 0) fields.push({ query: "", id: "" });
    setBookingClients(fields);
  };

  const handleBook = async (immediatePaid: boolean) => {
    if (!prefill) return;
    if (connectionState !== "online") {
      toast(getMutationBlockedMessage(connectionState), "error");
      return;
    }

    if (!bookingClients[0]?.id) {
      toast("Выберите клиента.", "error");
      return;
    }
    if (bookingClients.length >= 2 && (!bookingClients[1]?.query || !bookingClients[1]?.id)) {
      toast("Выберите второго клиента.", "error");
      return;
    }
    if (bookingClients.length >= 3 && (!bookingClients[2]?.query || !bookingClients[2]?.id)) {
      toast("Выберите третьего клиента.", "error");
      return;
    }
    if (!disciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }
    if (bookingPaymentMode === "package" && !linkedSubscriptionId) {
      toast("Выберите пакет для списания.", "error");
      return;
    }

    const rangeError = validateTimeRange(timeStart, timeEnd);
    if (rangeError) {
      toast(rangeError, "error");
      return;
    }

    const priceNum = bookingPaymentMode === "package" ? 0 : parseFloat(customPrice);
    if (bookingPaymentMode !== "package" && (Number.isNaN(priceNum) || priceNum < 0)) {
      toast("Укажите корректную стоимость урока.", "error");
      return;
    }

    if (linkedSubscriptionId) {
      const linkedSub = subscriptions.find((s) => s.id === linkedSubscriptionId);
      if (!linkedSub) {
        toast("Выбранный пакет не найден.", "error");
        return;
      }
      if (
        !bookingClientsMatchSubscription(linkedSub, {
          clientId1: bookingClients[0].id,
          clientId2: bookingClients.length >= 2 ? bookingClients[1].id : "",
          clientId3: bookingClients.length >= 3 ? bookingClients[2].id : "",
        })
      ) {
        toast("Клиенты урока должны совпадать с владельцами пакета.", "error");
        return;
      }
    }

    const conflict = findScheduleConflict(
      {
        date: prefill.date,
        timeStart,
        timeEnd,
        locationId: prefill.locationId,
      },
      personalLessons,
      scheduleSlots
    );
    if (conflict) {
      toast(`Конфликт: ${formatDateRu(prefill.date)} ${timeStart} — ${conflict}`, "error");
      return;
    }

    const res = await addPersonalLessons.mutateAsync({
      requireScope: true,
      type: pType,
      clientId1: bookingClients[0].id,
      clientId2: bookingClients.length >= 2 ? bookingClients[1].id : "",
      clientId3: bookingClients.length >= 3 ? bookingClients[2].id : "",
      dates: [prefill.date],
      timeStart,
      timeEnd,
      price: priceNum,
      paid: immediatePaid,
      disciplineId,
      locationId: prefill.locationId,
      teacherMemberId,
      subscriptionId: bookingPaymentMode === "package" ? linkedSubscriptionId || undefined : undefined,
    });

    if (!res.success) {
      toast(res.error ?? "Не удалось забронировать", "error");
      return;
    }

    if (immediatePaid && bookingPaymentMode !== "package" && priceNum > 0 && res.ids?.length) {
      const c1 = directoryClients.find((c) => c.id === bookingClients[0].id);
      const clientDisplay = c1
        ? formatClientName(c1.lastName, c1.firstName)
        : bookingClients[0].query || "Клиент";

      for (const lessonId of res.ids) {
        const paymentRes = await recordPersonalLessonPayment.mutateAsync({
          lessonId,
          clientId: bookingClients[0].id,
          clientDisplay,
          amount: priceNum,
          method: "cash",
          markPaid: false,
        });
        if (!paymentRes.success) {
          toast(paymentRes.error ?? "Урок забронирован, но оплата не зафиксирована", "error");
          onSuccess();
          onClose();
          return;
        }
      }
    }

    toast(
      linkedSubscriptionId && bookingPaymentMode === "package"
        ? "Урок оформлен, списание с пакета"
        : immediatePaid
          ? "Забронировано и оплачено"
          : "Внесено в календарь как неоплаченная бронь",
      "success"
    );
    onSuccess();
    onClose();
  };

  const subscriptionOwnerLabel = (sub: Subscription): string =>
    getSubscriptionClientIds(sub)
      .map((id) => {
        const c = clientMap[id];
        return c ? formatClientName(c.lastName, c.firstName) : id;
      })
      .join(" & ");

  return (
    <AnimatePresence>
      {prefill && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
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
                  Персональный урок
                </p>
                <h3 className="text-base font-semibold tracking-tight text-slate-900">Новая запись</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрыть"
                className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors shrink-0"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="panel-form-stack">
              <div className="field-stack">
                <label className={labelCls}>Локация</label>
                <div className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-700">
                  <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
                  {prefill.locationName}
                </div>
              </div>

              <div className="field-stack">
                <label className={labelCls}>Дата</label>
                <div className="flex items-center gap-2 px-3.5 py-2.5 bg-slate-100 border border-slate-200 rounded-lg text-sm text-slate-700">
                  <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
                  {formatDateRu(prefill.date)}
                </div>
              </div>

              <DisciplineSelect
                disciplines={disciplines}
                value={disciplineId}
                onChange={setDisciplineId}
                toast={toast}
              />

              {!isTeacher && (
                <AppSelect
                  label="Преподаватель"
                  value={teacherMemberId}
                  onChange={(e) => setTeacherMemberId(e.target.value)}
                  required
                >
                  {teacherOptions.length === 0 ? (
                    <option value="">Нет преподавателей</option>
                  ) : (
                    teacherOptions.map((member) => (
                      <option key={member.id} value={member.id}>
                        {memberDisplayName(member) ?? memberListLabel(member)}
                      </option>
                    ))
                  )}
                </AppSelect>
              )}

              <div className="field-stack">
                {bookingClients.map((client, idx) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      {packageLocked ? (
                        <div className="field-stack">
                          <label className={labelCls}>{idx === 0 ? "Клиент" : `Клиент ${idx + 1}`}</label>
                          <input
                            type="text"
                            readOnly
                            value={client.query}
                            className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-600 cursor-not-allowed"
                          />
                        </div>
                      ) : (
                        <ClientAutocomplete
                          label={idx === 0 ? "Клиент" : `Клиент ${idx + 1}`}
                          clients={activeClients}
                          query={client.query}
                          selectedId={client.id}
                          showAddClientButton
                          addClientLinkLabel="Новый клиент"
                          toast={toast}
                          onQueryChange={(q) => {
                            if (packageLocked) return;
                            setBookingClients((prev) => {
                              const next = [...prev];
                              next[idx] = { query: q, id: "" };
                              return next;
                            });
                          }}
                          onSelect={(c: Client) => {
                            if (packageLocked) return;
                            setBookingClients((prev) => {
                              const next = [...prev];
                              next[idx] = { query: `${c.lastName} ${c.firstName}`, id: c.id };
                              return next;
                            });
                          }}
                        />
                      )}
                    </div>
                    {!packageLocked && idx > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setBookingClients((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="mt-6 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer shrink-0"
                        title="Убрать клиента"
                        aria-label="Убрать клиента"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
                {!packageLocked && bookingClients.length < 3 && (
                  <button
                    type="button"
                    onClick={() => setBookingClients((prev) => [...prev, { query: "", id: "" }])}
                    className="w-full py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer"
                  >
                    ＋ Добавить клиента
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <TimeSelect label="Начало" value={timeStart} onChange={handleTimeStartChange} required />
                <TimeSelect label="Окончание" value={timeEnd} onChange={setTimeEnd} required />
              </div>

              <div className="field-stack">
                <label className={labelCls}>Способ оплаты</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setBookingPaymentMode("single");
                      setLinkedSubscriptionId("");
                    }}
                    className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                      bookingPaymentMode === "single"
                        ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                        : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                    }`}
                  >
                    Один урок
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
                    Списать с пакета
                  </button>
                </div>
              </div>

              {bookingPaymentMode === "single" && (
                <>
                  {lessonTariffs.length > 0 && (
                    <AppSelect
                      label="Тариф за урок"
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
                  )}
                  <div className="field-stack">
                    <label className={labelCls}>Стоимость</label>
                    <input
                      type="number"
                      placeholder="0"
                      value={customPrice}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm font-semibold"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => handleBook(true)}
                      disabled={connectionState !== "online" || addPersonalLessons.isPending}
                      title={getConnectionBlockReason(connectionState)}
                      className="py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                    >
                      С оплатой
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBook(false)}
                      disabled={connectionState !== "online" || addPersonalLessons.isPending}
                      title={getConnectionBlockReason(connectionState)}
                      className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                    >
                      Без оплаты
                    </button>
                  </div>
                </>
              )}

              {bookingPaymentMode === "package" && (
                <>
                  <AppSelect
                    label="Пакет"
                    value={linkedSubscriptionId}
                    onChange={(e) => {
                      const subId = e.target.value;
                      setLinkedSubscriptionId(subId);
                      if (subId) applySubscriptionToBooking(subId);
                    }}
                  >
                    <option value="">Выберите пакет...</option>
                    {availablePrivateSubs.map((sub) => (
                      <option key={sub.id} value={sub.id}>
                        {subscriptionOwnerLabel(sub)} — осталось {sub.lessonsLeft}
                      </option>
                    ))}
                  </AppSelect>
                  <button
                    type="button"
                    onClick={() => handleBook(false)}
                    disabled={connectionState !== "online" || addPersonalLessons.isPending}
                    title={getConnectionBlockReason(connectionState)}
                    className="py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                  >
                    Забронировать
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
