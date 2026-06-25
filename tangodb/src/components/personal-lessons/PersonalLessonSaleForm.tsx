import { useEffect, useMemo, useState } from "react";
import { CalendarDays, MapPin, Ticket, Trash2 } from "lucide-react";
import { useClients, useClientDirectory } from "../../hooks/useClients";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useAccessibleLocations } from "../../hooks/useLocations";
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
import { findScheduleConflict, formatScheduleConflictToast } from "../../lib/scheduleConflicts";
import type { PersonalLessonRef, ScheduleSlotRef } from "../../lib/scheduleConflicts";
import {
  expandWeeklyRecurrence,
  expandWeeklyRecurrenceByWeekCount,
  findLessonEntriesBeyondEndDate,
  groupSlotsByTime,
  uniqueWeeklyRecurrenceRows,
  type PersonalLessonSlot,
} from "../../lib/personalLessonDates";
import { computeAutoTimeEnd, validateTimeRange } from "../../lib/scheduleTime";
import { toISODateLocal, addDays } from "../../lib/scheduleWeek";
import {
  bookingClientsMatchSubscription,
  jsDayToIsoDow,
  formatClientName,
  formatCurrency,
  formatDateRu,
  getPriceLabel,
  filterPrivateLessonTariffsForSale,
  getSubscriptionClientIds,
  tariffParticipantType,
} from "../../lib/utils";
import type { Client, Subscription } from "../../types";
import AppSelect, { fieldCls } from "../ui/AppSelect";
import ClientAutocomplete from "../ui/ClientAutocomplete";
import DatePickerField from "../ui/DatePickerField";
import DisciplineSelect from "../ui/DisciplineSelect";
import SellPackageModal from "../ui/SellPackageModal";
import TimeSelect from "../ui/TimeSelect";
import type { ScheduleCellPrefill } from "../schedule/AddLessonTypePopup";

export type PersonalLessonSaleFormMode = "schedule-cell" | "standalone";

interface BookingClientField {
  query: string;
  id: string;
}

interface LessonDateEntry {
  date: string;
  timeStart: string;
  timeEnd: string;
}

function defaultLessonEntry(date: string): LessonDateEntry {
  return { date, timeStart: "14:00", timeEnd: "15:00" };
}

export interface PersonalLessonSaleFormProps {
  mode: PersonalLessonSaleFormMode;
  prefill?: ScheduleCellPrefill | null;
  teacherOptions: TeamMemberRow[];
  scheduleSlots: ScheduleSlotRef[];
  personalLessons: PersonalLessonRef[];
  toast: (msg: string, type?: "success" | "error" | "info") => void;
  onSuccess: () => void;
  /** Закрыть popup (режим schedule-cell). */
  onClose?: () => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";
const checkboxCls = "rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";
const addRowBtnCls =
  "w-full py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer";
const MAX_CLIENTS = 4;

function participantTypeFromCount(count: number): "solo" | "pair" | "trio" | "quad" {
  if (count >= 4) return "quad";
  if (count >= 3) return "trio";
  if (count === 2) return "pair";
  return "solo";
}

function validateBookingClients(clients: BookingClientField[]): string | null {
  if (!clients[0]?.id) return "Выберите клиента.";
  for (let i = 1; i < clients.length; i += 1) {
    if (!clients[i]?.query || !clients[i]?.id) {
      return `Выберите клиента ${i + 1}.`;
    }
  }
  return null;
}

export default function PersonalLessonSaleForm({
  mode,
  prefill = null,
  teacherOptions,
  scheduleSlots,
  personalLessons,
  toast,
  onSuccess,
  onClose,
}: PersonalLessonSaleFormProps) {
  const isScheduleCell = mode === "schedule-cell";
  const todayISO = toISODateLocal(new Date());

  const { memberId } = useOrganization();
  const { role, can } = usePermissions();
  const { connectionState } = useOnlineStatus();
  const { data: activeClients = [] } = useClients();
  const { data: directoryClients = [] } = useClientDirectory();
  const { data: disciplines = [] } = useDisciplines();
  const { data: prices = [] } = usePrices();
  const { data: subscriptions = [] } = useSubscriptions();
  const { locations: accessibleLocations = [] } = useAccessibleLocations();
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
  const [packageModalOpen, setPackageModalOpen] = useState(false);

  const [locationId, setLocationId] = useState("");
  const [lessonEntries, setLessonEntries] = useState<LessonDateEntry[]>(() => [defaultLessonEntry(todayISO)]);
  const [repeatWeekly, setRepeatWeekly] = useState(false);
  const [weeklyEndMode, setWeeklyEndMode] = useState<"date" | "weeks">("weeks");
  const [weeklyEndDate, setWeeklyEndDate] = useState("");
  const [weeklyWeekCount, setWeeklyWeekCount] = useState(4);

  const effectiveLocationId = isScheduleCell ? (prefill?.locationId ?? "") : locationId;

  const pType = participantTypeFromCount(bookingClients.length);

  const lessonTariffs = useMemo(
    () =>
      filterPrivateLessonTariffsForSale(prices, {
        locationId: effectiveLocationId || null,
        disciplineId: disciplineId || null,
      }),
    [prices, effectiveLocationId, disciplineId]
  );

  const clientMap = useMemo(
    () => Object.fromEntries(directoryClients.map((c) => [c.id, c])),
    [directoryClients]
  );

  const availablePrivateSubs = subscriptions.filter(
    (s) => s.category === "private" && s.status === "active" && s.lessonsLeft > 0
  );

  const packageLocked = bookingPaymentMode === "package" && !!linkedSubscriptionId;

  useEffect(() => {
    if (isScheduleCell) {
      if (!prefill) return;
      setBookingClients([{ query: "", id: "" }]);
      setTimeStart(prefill.timeStart);
      setTimeEnd(computeAutoTimeEnd(prefill.timeStart, []));
      setCustomPrice("");
      setSelectedLessonTariffId("");
      setLinkedSubscriptionId("");
      setBookingPaymentMode(null);
      if (disciplines.length > 0) setDisciplineId(disciplines[0].id);
      if (isTeacher && memberId) {
        setTeacherMemberId(memberId);
      } else if (teacherOptions.length > 0) {
        setTeacherMemberId(teacherOptions[0].id);
      }
      return;
    }

    if (disciplines.length > 0 && !disciplineId) setDisciplineId(disciplines[0].id);
    if (accessibleLocations.length > 0 && !locationId) setLocationId(accessibleLocations[0].id);
    if (isTeacher && memberId) {
      setTeacherMemberId(memberId);
    } else if (teacherOptions.length > 0 && !teacherMemberId) {
      setTeacherMemberId(teacherOptions[0].id);
    }
  }, [
    isScheduleCell,
    prefill,
    disciplines,
    teacherOptions,
    isTeacher,
    memberId,
    accessibleLocations,
    disciplineId,
    locationId,
    teacherMemberId,
  ]);

  useEffect(() => {
    if (lessonTariffs.length > 0 && selectedLessonTariffId === "") {
      const first = lessonTariffs[0];
      setSelectedLessonTariffId(first.id!);
      setCustomPrice(first.price.toString());
    }
  }, [lessonTariffs, selectedLessonTariffId]);

  useEffect(() => {
    if (selectedLessonTariffId && !lessonTariffs.some((t) => t.id === selectedLessonTariffId)) {
      setSelectedLessonTariffId("");
      setCustomPrice("");
    }
  }, [lessonTariffs, selectedLessonTariffId]);

  const sameDayLessons = useMemo(() => {
    if (!isScheduleCell || !prefill) return [];
    return personalLessons
      .filter((l) => l.date === prefill.date && l.locationId === prefill.locationId)
      .map((l) => ({ timeStart: l.timeStart, timeEnd: l.timeEnd }));
  }, [isScheduleCell, prefill, personalLessons]);

  const handleTimeStartChange = (next: string) => {
    setTimeStart(next);
    if (isScheduleCell) {
      setTimeEnd(computeAutoTimeEnd(next, sameDayLessons));
    }
  };

  const applyLessonTariff = (tariffId: string) => {
    const tariff = lessonTariffs.find((t) => t.id === tariffId);
    if (!tariff) return;
    setSelectedLessonTariffId(tariffId);
    setCustomPrice(tariff.price.toString());
    if (packageLocked) return;
    const participant = tariffParticipantType(tariff);
    const neededFields =
      participant === "solo" ? 1 : participant === "pair" ? 2 : participant === "trio" ? 3 : 4;
    setBookingClients((prev) => {
      const next = [...prev];
      while (next.length < neededFields) next.push({ query: "", id: "" });
      while (next.length > neededFields) next.pop();
      return next;
    });
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

  const resolveLessonSlots = (): PersonalLessonSlot[] | null => {
    if (isScheduleCell) {
      if (!prefill) return null;
      return [{ date: prefill.date, timeStart, timeEnd }];
    }

    const filteredEntries = lessonEntries.filter((e) => e.date);
    if (filteredEntries.length === 0) {
      toast("Выберите дату.", "error");
      return null;
    }

    if (!repeatWeekly) {
      return filteredEntries.map(({ date, timeStart, timeEnd }) => ({ date, timeStart, timeEnd }));
    }

    const startDate = [...filteredEntries.map((e) => e.date)].sort()[0];
    const rows = uniqueWeeklyRecurrenceRows(
      filteredEntries.map(({ date, timeStart, timeEnd }) => ({
        dayOfWeek: jsDayToIsoDow(new Date(`${date}T12:00:00`).getDay()),
        timeStart,
        timeEnd,
      }))
    );

    if (weeklyEndMode === "weeks") {
      if (weeklyWeekCount < 1) {
        toast("Укажите количество недель.", "error");
        return null;
      }
      const endDate = addDays(startDate, weeklyWeekCount * 7 - 1);
      const beyondEnd = findLessonEntriesBeyondEndDate(filteredEntries, endDate);
      if (beyondEnd.length > 0) {
        toast(
          `Даты уроков (${beyondEnd.map(formatDateRu).join(", ")}) позже окончания повторения (${formatDateRu(endDate)}).`,
          "error"
        );
        return null;
      }
      return expandWeeklyRecurrenceByWeekCount(startDate, weeklyWeekCount, rows);
    }

    if (!weeklyEndDate) {
      toast("Укажите дату окончания.", "error");
      return null;
    }
    if (weeklyEndDate < startDate) {
      toast("Дата окончания должна быть не раньше даты начала.", "error");
      return null;
    }
    const beyondEnd = findLessonEntriesBeyondEndDate(filteredEntries, weeklyEndDate);
    if (beyondEnd.length > 0) {
      toast(
        `Даты уроков (${beyondEnd.map(formatDateRu).join(", ")}) позже даты окончания повторения (${formatDateRu(weeklyEndDate)}).`,
        "error"
      );
      return null;
    }
    const slots = expandWeeklyRecurrence(startDate, weeklyEndDate, rows);
    if (slots.length === 0) {
      toast("Не удалось сгенерировать даты по выбранному расписанию.", "error");
      return null;
    }
    return slots;
  };

  const handleBook = async (immediatePaid: boolean) => {
    if (connectionState !== "online") {
      toast(getMutationBlockedMessage(connectionState), "error");
      return;
    }

    if (!isScheduleCell && !locationId) {
      toast("Выберите локацию.", "error");
      return;
    }

    const clientError = validateBookingClients(bookingClients);
    if (clientError) {
      toast(clientError, "error");
      return;
    }

    if (!disciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }

    if (!isScheduleCell && !teacherMemberId) {
      toast("Выберите преподавателя.", "error");
      return;
    }

    if (bookingPaymentMode === "package" && !linkedSubscriptionId) {
      toast("Выберите пакет для списания.", "error");
      return;
    }

    const slots = resolveLessonSlots();
    if (!slots?.length) return;

    for (const slot of slots) {
      const rangeError = validateTimeRange(slot.timeStart, slot.timeEnd);
      if (rangeError) {
        toast(`${formatDateRu(slot.date)}: ${rangeError}`, "error");
        return;
      }
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
          clientId4: bookingClients.length >= 4 ? bookingClients[3].id : "",
        })
      ) {
        toast("Клиенты урока должны совпадать с владельцами пакета.", "error");
        return;
      }
    }

    for (const slot of slots) {
      const conflict = findScheduleConflict(
        {
          date: slot.date,
          timeStart: slot.timeStart,
          timeEnd: slot.timeEnd,
          locationId: effectiveLocationId,
        },
        personalLessons,
        scheduleSlots
      );
      if (conflict) {
        toast(formatScheduleConflictToast(slot.date, conflict), "error");
        return;
      }
    }

    const slotGroups = groupSlotsByTime(slots);
    const createdIds: string[] = [];

    for (const group of slotGroups) {
      const res = await addPersonalLessons.mutateAsync({
        requireScope: true,
        type: pType,
        clientId1: bookingClients[0].id,
        clientId2: bookingClients.length >= 2 ? bookingClients[1].id : "",
        clientId3: bookingClients.length >= 3 ? bookingClients[2].id : "",
        clientId4: bookingClients.length >= 4 ? bookingClients[3].id : "",
        dates: group.dates,
        timeStart: group.timeStart,
        timeEnd: group.timeEnd,
        price: priceNum,
        paid: immediatePaid,
        disciplineId,
        locationId: effectiveLocationId,
        teacherMemberId,
        subscriptionId: bookingPaymentMode === "package" ? linkedSubscriptionId || undefined : undefined,
      });

      if (!res.success) {
        toast(res.error ?? "Не удалось забронировать", "error");
        return;
      }
      if (res.ids) createdIds.push(...res.ids);
    }

    if (immediatePaid && bookingPaymentMode !== "package" && priceNum > 0 && createdIds.length) {
      const c1 = directoryClients.find((c) => c.id === bookingClients[0].id);
      const clientDisplay = c1
        ? formatClientName(c1.lastName, c1.firstName)
        : bookingClients[0].query || "Клиент";

      for (const lessonId of createdIds) {
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
          onClose?.();
          return;
        }
      }
    }

    const countLabel = createdIds.length > 1 ? ` (${createdIds.length} уроков)` : "";
    toast(
      linkedSubscriptionId && bookingPaymentMode === "package"
        ? `Урок оформлен${countLabel}, списание с пакета`
        : immediatePaid
          ? `Забронировано и оплачено${countLabel}`
          : `Внесено в календарь как неоплаченная бронь${countLabel}`,
      "success"
    );
    onSuccess();
    onClose?.();
  };

  const subscriptionOwnerLabel = (sub: Subscription): string =>
    getSubscriptionClientIds(sub)
      .map((id) => {
        const c = clientMap[id];
        return c ? formatClientName(c.lastName, c.firstName) : id;
      })
      .join(" & ");

  if (isScheduleCell && !prefill) return null;

  const selectedLocationName =
    isScheduleCell && prefill
      ? prefill.locationName
      : accessibleLocations.find((l) => l.id === locationId)?.name ?? "";

  const renderDateSection = () => {
    if (isScheduleCell && prefill) {
      return (
        <div className="field-stack">
          <label className={labelCls}>Дата</label>
          <div className="flex items-center gap-2 h-10 px-3.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700">
            <CalendarDays className="w-4 h-4 text-slate-400 shrink-0" />
            {formatDateRu(prefill.date)}
          </div>
        </div>
      );
    }

    const updateEntry = (index: number, patch: Partial<LessonDateEntry>) => {
      setLessonEntries((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...patch };
        return next;
      });
    };

    return (
      <>
        {lessonEntries.map((entry, idx) => (
          <div key={idx} className={idx === 0 ? "field-stack" : "flex items-end gap-2"}>
            <div className={`grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 ${idx > 0 ? "flex-1 min-w-0" : ""}`}>
              <DatePickerField
                label="Дата"
                value={entry.date}
                onChange={(val) => updateEntry(idx, { date: val })}
                min={todayISO}
                required
              />
              <TimeSelect
                label="Начало"
                value={entry.timeStart}
                onChange={(val) => updateEntry(idx, { timeStart: val })}
                required
              />
              <TimeSelect
                label="Окончание"
                value={entry.timeEnd}
                onChange={(val) => updateEntry(idx, { timeEnd: val })}
                required
              />
            </div>
            {idx > 0 && (
              <button
                type="button"
                onClick={() => setLessonEntries((prev) => prev.filter((_, i) => i !== idx))}
                aria-label="Убрать дату"
                className="mb-0.5 p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}

        <button
          type="button"
          onClick={() => setLessonEntries((prev) => [...prev, defaultLessonEntry(todayISO)])}
          className={addRowBtnCls}
        >
          ＋ Добавить дату
        </button>
      </>
    );
  };

  const startDate = lessonEntries.filter((e) => e.date).map((e) => e.date).sort()[0] ?? todayISO;

  const renderWeeklyRepeatSection = () => {
    if (isScheduleCell) return null;

    return (
      <>
        <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={repeatWeekly}
            onChange={(e) => setRepeatWeekly(e.target.checked)}
            className={`${checkboxCls} mt-0.5`}
          />
          <span className="text-xs leading-snug font-semibold">Повторять еженедельно</span>
        </label>

        {repeatWeekly && (
          <div className="field-stack space-y-3">
            <div className="field-stack">
              <label className={labelCls}>Окончание</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setWeeklyEndMode("weeks")}
                  className={`py-2 rounded-lg border font-sans text-[10px] font-semibold uppercase tracking-wider cursor-pointer ${
                    weeklyEndMode === "weeks"
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  N недель
                </button>
                <button
                  type="button"
                  onClick={() => setWeeklyEndMode("date")}
                  className={`py-2 rounded-lg border font-sans text-[10px] font-semibold uppercase tracking-wider cursor-pointer ${
                    weeklyEndMode === "date"
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-slate-50 text-slate-600 border-slate-200"
                  }`}
                >
                  До даты
                </button>
              </div>
            </div>
            {weeklyEndMode === "weeks" ? (
              <AppSelect
                label="Количество недель"
                value={String(weeklyWeekCount)}
                onChange={(e) => setWeeklyWeekCount(Number(e.target.value) || 2)}
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} недели
                  </option>
                ))}
              </AppSelect>
            ) : (
              <DatePickerField
                label="Дата окончания"
                value={weeklyEndDate}
                onChange={setWeeklyEndDate}
                min={startDate || todayISO}
                required
              />
            )}
          </div>
        )}
      </>
    );
  };

  return (
    <>
      <div className="panel-form-stack">
        {can("personal_lessons.sell") && (
          <button
            type="button"
            onClick={() => setPackageModalOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-[10px] font-sans font-semibold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <Ticket className="w-3.5 h-3.5" />
            Продать пакет уроков
          </button>
        )}

        {isScheduleCell ? (
          <div className="field-stack">
            <label className={labelCls}>Локация</label>
            <div className="flex items-center gap-2 h-10 px-3.5 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700">
              <MapPin className="w-4 h-4 text-slate-400 shrink-0" />
              {selectedLocationName}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AppSelect
              label="Локация"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              required
            >
              {accessibleLocations.length === 0 ? (
                <option value="">Нет доступных локаций</option>
              ) : (
                accessibleLocations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name}
                  </option>
                ))
              )}
            </AppSelect>
            <DisciplineSelect
              disciplines={disciplines}
              value={disciplineId}
              onChange={setDisciplineId}
              toast={toast}
            />
          </div>
        )}

        {renderDateSection()}

        {renderWeeklyRepeatSection()}

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

        {isScheduleCell && (
          <DisciplineSelect
            disciplines={disciplines}
            value={disciplineId}
            onChange={setDisciplineId}
            toast={toast}
          />
        )}

        {isScheduleCell && (
          <div className="grid grid-cols-2 gap-3">
            <TimeSelect label="Начало" value={timeStart} onChange={handleTimeStartChange} required />
            <TimeSelect label="Окончание" value={timeEnd} onChange={setTimeEnd} required />
          </div>
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
                      className={`${fieldCls} bg-slate-100 text-slate-600 cursor-not-allowed`}
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
                  onClick={() => setBookingClients((prev) => prev.filter((_, i) => i !== idx))}
                  className="mt-6 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer shrink-0"
                  title="Убрать клиента"
                  aria-label="Убрать клиента"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          {!packageLocked && bookingClients.length < MAX_CLIENTS && (
            <button
              type="button"
              onClick={() => setBookingClients((prev) => [...prev, { query: "", id: "" }])}
              className={addRowBtnCls}
            >
              ＋ Добавить клиента
            </button>
          )}
        </div>

        <div className="field-stack">
          <label className={labelCls}>Способ оплаты</label>
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
              <div className="grid grid-cols-[2fr_1fr] gap-3">
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
                <div className="field-stack">
                  <label className={labelCls}>Стоимость за один урок</label>
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
                <label className={labelCls}>Стоимость за один урок</label>
                <input
                  type="number"
                  placeholder="0"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className={`${fieldCls} font-semibold`}
                />
              </div>
            )}
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
            {availablePrivateSubs.length === 0 ? (
              <p className="text-xs text-slate-500 font-sans leading-relaxed">
                Нет оформленных пакетов. Оформить пакет можно в{" "}
                <button
                  type="button"
                  onClick={() => setPackageModalOpen(true)}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold underline-offset-2 hover:underline cursor-pointer"
                >
                  Продажа пакета
                </button>
                .
              </p>
            ) : (
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
            )}
            <button
              type="button"
              onClick={() => handleBook(false)}
              disabled={
                connectionState !== "online" ||
                addPersonalLessons.isPending ||
                availablePrivateSubs.length === 0 ||
                !linkedSubscriptionId
              }
              title={getConnectionBlockReason(connectionState)}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
            >
              Забронировать
            </button>
          </>
        )}
      </div>

      <SellPackageModal
        open={packageModalOpen}
        onClose={() => setPackageModalOpen(false)}
        toast={toast}
        clients={activeClients}
        disciplines={disciplines}
        prices={prices}
        stackLayer={isScheduleCell ? "above" : undefined}
      />
    </>
  );
}
