/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Sparkles, Search, FolderClosed, Trash2, BadgePlus, CalendarDays, ChevronLeft, ChevronRight, Ticket, Edit, X } from "lucide-react";
import { useClients } from "../hooks/useClients";
import { useDisciplines } from "../hooks/useDisciplines";
import { usePrices } from "../hooks/usePrices";
import {
  findBookingScheduleConflict,
  formatClientName,
  formatCurrency,
  formatMonthTitleRu,
  getPersonalLessonTariffLabel,
  getPriceLabel,
  getPrivateLessonTariffs,
  getSubscriptionClientIds,
  bookingClientsMatchSubscription,
  tariffParticipantType,
} from "../lib/utils";
import { useSchedule } from "../hooks/useSchedule";
import {
  useAddPersonalLessons,
  useDeletePersonalLesson,
  usePersonalLessons,
  useUpdatePersonalLesson,
  useUpdatePersonalPaid,
} from "../hooks/usePersonalLessons";
import { useSubscriptions } from "../hooks/useSubscriptions";
import { useUIStore } from "../store/ui";
import ClientAutocomplete from "./ui/ClientAutocomplete";
import AppSelect from "./ui/AppSelect";
import ConfirmDialog from "./ui/ConfirmDialog";
import SellPackageModal from "./ui/SellPackageModal";
import DisciplineSelect from "./ui/DisciplineSelect";
import LoadingState from "./ui/LoadingState";
import PageTabs, { pageTabPanelCls } from "./ui/PageTabs";
import type { ToastType } from "../App";
import type { Client, PersonalLesson, Subscription } from "../types";

interface PersonalLessonsPanelProps {
  initialTab?: "view" | "sell" | "book";
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

interface BookingClientField {
  query: string;
  id: string;
}

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function lessonYearMonth(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function PersonalLessonsPanel({
  initialTab = "view",
  toast,
}: PersonalLessonsPanelProps) {
  const navigate = useNavigate();
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);
  const normalizedInitialTab = initialTab === "book" ? "sell" : initialTab;

  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const { data: disciplines = [], isLoading: disciplinesLoading } = useDisciplines();
  const { data: personalLessons = [], isLoading: lessonsLoading } = usePersonalLessons();
  const { data: schedule = [], isLoading: scheduleLoading } = useSchedule();
  const { data: prices = [], isLoading: pricesLoading } = usePrices();
  const { data: subscriptions = [] } = useSubscriptions();
  const addPersonalLessons = useAddPersonalLessons();
  const updatePersonalPaid = useUpdatePersonalPaid();
  const updatePersonalLesson = useUpdatePersonalLesson();
  const deletePersonalLesson = useDeletePersonalLesson();

  const isLoading = clientsLoading || disciplinesLoading || lessonsLoading || scheduleLoading || pricesLoading;

  const [activeTab, setActiveTab] = useState<"view" | "sell">(normalizedInitialTab);
  const [packageModalOpen, setPackageModalOpen] = useState(false);

  useEffect(() => {
    setActiveTab(normalizedInitialTab);
  }, [normalizedInitialTab]);

  const switchTab = (tab: "view" | "sell") => {
    setActiveTab(tab);
    setPersonalTab(tab);
    if (tab === "sell") navigate("/personal/sell");
    else navigate("/personal");
  };

  // Browse filters
  const [viewMonth, setViewMonth] = useState(currentYearMonth);
  const [pvFilter, setPvFilter] = useState<"all" | "yes" | "no">("all");
  const [search, setSearch] = useState("");

  // Booking form states
  const [bookingClients, setBookingClients] = useState<BookingClientField[]>([{ query: "", id: "" }]);
  const [dates, setDates] = useState<string[]>([""]);
  const [timeStart, setTimeStart] = useState("14:00");
  const [timeEnd, setTimeEnd] = useState("15:00");
  const [customPrice, setCustomPrice] = useState("");
  const [selectedLessonTariffId, setSelectedLessonTariffId] = useState<number | "">("");
  const [linkedSubscriptionId, setLinkedSubscriptionId] = useState("");
  const [disciplineId, setDisciplineId] = useState<number | "">("");
  const [bookingPaymentMode, setBookingPaymentMode] = useState<"single" | "package" | null>(null);


  const pType: "solo" | "pair" | "trio" =
    bookingClients.length >= 3 ? "trio" : bookingClients.length === 2 ? "pair" : "solo";

  const lessonTariffs = getPrivateLessonTariffs(prices);

  useEffect(() => {
    if (lessonTariffs.length > 0 && selectedLessonTariffId === "") {
      const first = lessonTariffs[0];
      setSelectedLessonTariffId(first.id!);
      setCustomPrice(first.price.toString());
    }
  }, [lessonTariffs, selectedLessonTariffId]);

  const clientMap = clients.reduce(
    (acc, c) => ({ ...acc, [String(c.id)]: c }),
    {} as Record<string, Client>
  );

  const subscriptionOwnerLabel = (sub: Subscription): string =>
    getSubscriptionClientIds(sub)
      .map((id) => {
        const c = clientMap[id];
        return c ? formatClientName(c.lastName, c.firstName) : id;
      })
      .join(" & ");

  const availablePrivateSubs = subscriptions.filter(
    (s) => s.category === "private" && s.status === "active" && s.lessonsLeft > 0
  );

  const packageLocked = bookingPaymentMode === "package" && !!linkedSubscriptionId;

  const selectBookingPaymentMode = (mode: "single" | "package") => {
    setBookingPaymentMode(mode);
    setLinkedSubscriptionId("");
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

  const [deleteTarget, setDeleteTarget] = useState<PersonalLesson | null>(null);
  const [editTarget, setEditTarget] = useState<PersonalLesson | null>(null);
  const [editDate, setEditDate] = useState("");
  const [editTimeStart, setEditTimeStart] = useState("");
  const [editTimeEnd, setEditTimeEnd] = useState("");

  useEffect(() => {
    if (disciplines.length > 0 && disciplineId === "") {
      setDisciplineId(disciplines[0].id);
    }
  }, [disciplines, disciplineId]);

  // Pricing helper
  const applyLessonTariff = (tariffId: number) => {
    const matched = lessonTariffs.find((p) => p.id === tariffId);
    if (matched) {
      setSelectedLessonTariffId(tariffId);
      setCustomPrice(matched.price.toString());
      const participant = tariffParticipantType(matched);
      const neededFields = participant === "solo" ? 1 : participant === "pair" ? 2 : 3;
      setBookingClients((prev) => {
        const next = [...prev];
        while (next.length < neededFields) next.push({ query: "", id: "" });
        while (next.length > neededFields) next.pop();
        return next;
      });
    }
  };

  // Multiple date controls
  const handleAddDate = () => setDates([...dates, ""]);

  const handleRemoveDate = (index: number) => {
    if (dates.length <= 1) return;
    setDates(dates.filter((_, i) => i !== index));
  };

  const handleRemoveBookingClient = (index: number) => {
    if (index <= 0 || bookingClients.length <= 1) return;
    setBookingClients((prev) => prev.filter((_, i) => i !== index));
  };

  const handleDateChange = (index: number, val: string) => {
    const next = [...dates];
    next[index] = val;
    setDates(next);
  };

  const handleBook = async (immediatePaid: boolean) => {
    if (!bookingClients[0]?.query || !bookingClients[0]?.id) {
      toast("Выберите клиента из списка.", "error");
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

    const filteredDates = dates.filter((d) => d !== "");
    if (filteredDates.length === 0) {
      toast("Выберите хотя бы одну дату бронирования.", "error");
      return;
    }

    const priceNum = bookingPaymentMode === "package" ? 0 : parseFloat(customPrice);
    if (bookingPaymentMode !== "package" && (isNaN(priceNum) || priceNum < 0)) {
      toast("Укажите корректную стоимость урока.", "error");
      return;
    }
    if (!timeStart || !timeEnd) {
      toast("Укажите время начала и окончания урока.", "error");
      return;
    }
    if (timeEnd <= timeStart) {
      toast("Время окончания должно быть позже начала.", "error");
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

    const uniqueDates = new Set(filteredDates);
    if (uniqueDates.size !== filteredDates.length) {
      toast("Одна и та же дата указана несколько раз.", "error");
      return;
    }

    for (const date of filteredDates) {
      const conflict = findBookingScheduleConflict(date, timeStart, timeEnd, personalLessons, schedule);
      if (conflict) {
        toast(`Конфликт: ${formatDateLabel(date)} ${timeStart} — ${conflict}`, "error");
        return;
      }
    }

    const payload = {
      type: pType,
      clientId1: bookingClients[0].id,
      clientId2: bookingClients.length >= 2 ? bookingClients[1].id : "",
      clientId3: bookingClients.length >= 3 ? bookingClients[2].id : "",
      dates: filteredDates,
      timeStart,
      timeEnd,
      price: priceNum,
      paid: immediatePaid,
      disciplineId: disciplineId as number,
      subscriptionId: bookingPaymentMode === "package" ? linkedSubscriptionId || undefined : undefined,
    };

    const res = await addPersonalLessons.mutateAsync(payload);
    if (!res.success) {
      toast(res.error || "Не удалось забронировать", "error");
    } else {
      toast(
        linkedSubscriptionId && bookingPaymentMode === "package"
          ? "Урок оформлен, списание с пакета"
          : immediatePaid
            ? "Забронировано и оплачено"
            : "Внесено в календарь как неоплаченная бронь",
        "success"
      );
      setBookingClients([{ query: "", id: "" }]);
      setDates([""]);
      setCustomPrice("");
      setLinkedSubscriptionId("");
      setBookingPaymentMode(null);
      setTimeStart("14:00");
      setTimeEnd("15:00");
    }
  };

  const handleTogglePaid = async (lesson: PersonalLesson) => {
    const nextStatus = lesson.paid !== "yes";
    const res = await updatePersonalPaid.mutateAsync({ id: lesson.id, paid: nextStatus });
    if (!res.success) {
      toast(res.error || "Ошибка изменения статуса", "error");
    } else {
      toast(nextStatus ? "Платёж подтверждён, зачислен в кассу" : "Оплата отменена", "success");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await deletePersonalLesson.mutateAsync(deleteTarget.id);
    if (!res.success) {
      toast(res.error || "Не удалось удалить запись", "error");
    } else {
      toast("Бронь персонального урока удалена", "success");
      setDeleteTarget(null);
    }
  };

  const startEditLesson = (lesson: PersonalLesson) => {
    setEditTarget(lesson);
    setEditDate(lesson.date);
    setEditTimeStart(lesson.timeStart);
    setEditTimeEnd(lesson.timeEnd);
  };

  useEffect(() => {
    if (!editTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditTarget(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editTarget]);

  const handleSaveEditLesson = async () => {
    if (!editTarget) return;
    if (!editDate || !editTimeStart || !editTimeEnd) {
      toast("Заполните дату и время урока.", "error");
      return;
    }
    if (editTimeEnd <= editTimeStart) {
      toast("Время окончания должно быть позже начала.", "error");
      return;
    }

    const conflict = findBookingScheduleConflict(
      editDate,
      editTimeStart,
      editTimeEnd,
      personalLessons,
      schedule,
      editTarget.id
    );
    if (conflict) {
      toast(`Конфликт: ${formatDateLabel(editDate)} ${editTimeStart} — ${conflict}`, "error");
      return;
    }

    const res = await updatePersonalLesson.mutateAsync({
      id: editTarget.id,
      date: editDate,
      timeStart: editTimeStart,
      timeEnd: editTimeEnd,
    });
    if (!res.success) {
      toast(res.error || "Не удалось сохранить изменения", "error");
    } else {
      toast("Урок обновлён", "success");
      setEditTarget(null);
    }
  };

  const isViewingCurrentMonth = viewMonth === currentYearMonth();
  const monthLessons = personalLessons.filter((l) => lessonYearMonth(l.date) === viewMonth);
  const monthLessonCount = monthLessons.length;
  const monthPaidCount = monthLessons.filter((l) => l.paid === "yes").length;
  const monthUnpaidSum = monthLessons.filter((l) => l.paid === "no").reduce((sum, l) => sum + l.price, 0);

  const clientNameFromMap = (clientId: string): string => {
    const id = clientId.trim();
    if (!id) return "";
    const client = clientMap[id];
    if (client) return formatClientName(client.lastName, client.firstName);
    if (/[^\d]/.test(id)) return id;
    return id;
  };

  const renderClientNames = (lesson: PersonalLesson) => {
    if (lesson.clientDisplay && lesson.clientDisplay !== "Клиент не указан") {
      return lesson.clientDisplay;
    }

    const names = [
      clientNameFromMap(lesson.clientId1),
      lesson.clientId2 ? clientNameFromMap(lesson.clientId2) : "",
      lesson.clientId3 ? clientNameFromMap(lesson.clientId3) : "",
    ].filter(Boolean);

    return names.length ? names.join(" & ") : "Клиент не указан";
  };

  const isUpcomingLesson = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const lessonDate = new Date(dateStr + "T12:00:00");
    lessonDate.setHours(0, 0, 0, 0);
    return lessonDate >= today;
  };

  const formatDateLabel = (dateStr: string) => {
    const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    const d = new Date(dateStr + "T12:00:00");
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")} (${days[d.getDay()]})`;
  };

  const filteredLessons = personalLessons
    .filter((l) => lessonYearMonth(l.date) === viewMonth)
    .filter((l) => pvFilter === "all" || l.paid === pvFilter)
    .filter((l) => {
      if (!search.trim()) return true;
      const c1Str = clientNameFromMap(l.clientId1);
      const c2Str = l.clientId2 ? clientNameFromMap(l.clientId2) : "";
      const c3Str = l.clientId3 ? clientNameFromMap(l.clientId3) : "";
      return `${c1Str} ${c2Str} ${c3Str}`.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeStart.localeCompare(a.timeStart));

  const monthTotalSum = filteredLessons.reduce((s, l) => s + l.price, 0);
  const hasUnpaidInView = filteredLessons.some((l) => l.paid === "no");

  if (isLoading) return <LoadingState label="Загрузка персональных уроков..." />;

  const personalTabs = [
    { id: "view", label: "Просмотр", icon: FolderClosed },
    { id: "sell", label: "Продажа", icon: BadgePlus },
  ] as const;

  return (
    <div>
      <PageTabs tabs={[...personalTabs]} activeTab={activeTab} onChange={switchTab} />

      {activeTab === "view" ? (
        /* SCREEN 1: BROWSE PRIVATE SESSIONS */
        <div className="panel-page-stack">
          <div className="bg-white rounded-b-xl rounded-tr-xl border border-slate-200 border-t-0 shadow-xs overflow-hidden -mt-px">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-200/70 bg-slate-50/50">
              <button
                type="button"
                onClick={() => setViewMonth((m) => shiftMonth(m, -1))}
                className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label="Предыдущий месяц"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-sm font-semibold text-slate-800">{formatMonthTitleRu(viewMonth)}</span>
                {!isViewingCurrentMonth && (
                  <button
                    type="button"
                    onClick={() => setViewMonth(currentYearMonth())}
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    Вернуться к текущему месяцу
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewMonth((m) => shiftMonth(m, 1))}
                className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label="Следующий месяц"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/70">
              <div className="px-4 py-2.5">
                <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                  {isViewingCurrentMonth ? "Уроки в этом месяце" : "Уроков за месяц"}
                </p>
                <h4 className="text-xl font-semibold text-slate-800 mt-0.5 leading-none">{monthLessonCount}</h4>
              </div>
              <div className="px-4 py-2.5">
                <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">
                  {isViewingCurrentMonth ? "Оплаченных в этом месяце" : "Оплаченных за месяц"}
                </p>
                <h4 className="text-xl font-semibold text-emerald-700 mt-0.5 leading-none">{monthPaidCount}</h4>
              </div>
              <div className="px-4 py-2.5">
                <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">Ожидает оплаты</p>
                <h4 className="text-xl font-sans font-semibold text-rose-700 mt-0.5 leading-none">{formatCurrency(monthUnpaidSum)}</h4>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs panel-card-stack">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              {/* All / Paid / Unpaid filter */}
              <div className="flex bg-slate-100 rounded-lg p-1 text-xs font-semibold gap-1">
                <button
                  onClick={() => setPvFilter("all")}
                  className={`px-4 py-1.5 rounded-md cursor-pointer transition-all ${
                    pvFilter === "all" ? "bg-white text-slate-900 shadow-xs font-semibold" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Все
                </button>
                <button
                  onClick={() => setPvFilter("yes")}
                  className={`px-4 py-1.5 rounded-md cursor-pointer transition-all ${
                    pvFilter === "yes" ? "bg-white text-emerald-700 shadow-xs font-semibold" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Оплаченные
                </button>
                <button
                  onClick={() => setPvFilter("no")}
                  className={`px-4 py-1.5 rounded-md cursor-pointer transition-all ${
                    pvFilter === "no" ? "bg-white text-rose-700 shadow-xs font-semibold" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Неоплаченные
                </button>
              </div>

              <div className="relative w-full md:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Поиск по имени клиента..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg text-xs transition-all"
                />
              </div>
            </div>

            {filteredLessons.length === 0 ? (
              <div className="text-center py-20 text-slate-400 space-y-3">
                <Sparkles className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm">
                  {monthLessons.length === 0
                    ? `В ${formatMonthTitleRu(viewMonth)} персональных уроков нет.`
                    : "Персональных уроков с такими критериями нет."}
                </p>
                <button
                  onClick={() => switchTab("sell")}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                >
                  Забронировать урок →
                </button>
              </div>
            ) : (
              <div className="panel-card-stack">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-sans font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md">
                    {formatMonthTitleRu(viewMonth)}
                  </span>
                  <span className="text-xs font-sans text-slate-400 font-semibold">
                    Итого: {formatCurrency(monthTotalSum)}
                    {hasUnpaidInView && <span className="text-rose-600 font-sans ml-2">(есть долг)</span>}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredLessons.map((l) => {
                    const isPaid = l.paid === "yes";
                    const isUpcoming = isUpcomingLesson(l.date);
                    const tariffLabel = getPersonalLessonTariffLabel(l, prices, subscriptions);
                    const amountCls = `font-sans text-xs font-semibold ${isPaid ? "text-slate-500" : "text-rose-600"}`;

                    return (
                      <div
                        key={l.id}
                        className={`border rounded-xl p-4 space-y-2 transition-all hover:shadow-sm ${
                          isUpcoming
                            ? "bg-emerald-50 border-emerald-200"
                            : isPaid
                              ? "bg-white border-slate-200"
                              : "bg-white border-rose-200"
                        }`}
                      >
                        <p className={`${amountCls} leading-tight`}>{tariffLabel}</p>

                        <div className="relative">
                          <div className="inline-flex items-center gap-1 font-sans text-xs text-slate-400">
                            <CalendarDays className="w-3 h-3 shrink-0" />
                            {formatDateLabel(l.date)} · {l.timeStart} – {l.timeEnd}
                          </div>
                          <div className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => startEditLesson(l)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all cursor-pointer"
                              title="Редактировать"
                              aria-label="Редактировать урок"
                            >
                              <Edit className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(l)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all cursor-pointer"
                              title="Удалить"
                              aria-label="Удалить бронь"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <p className="text-sm font-semibold text-slate-800 leading-tight">{renderClientNames(l)}</p>

                        <div className="flex items-center justify-between gap-2">
                          <p className={amountCls}>{formatCurrency(l.price)}</p>
                          <button
                            type="button"
                            onClick={() => handleTogglePaid(l)}
                            disabled={updatePersonalPaid.isPending}
                            title={isPaid ? "Нажмите, чтобы отменить оплату" : "Нажмите, чтобы подтвердить оплату"}
                            className={`text-xs font-sans font-semibold shrink-0 cursor-pointer disabled:opacity-60 ${
                              isPaid ? "text-emerald-600 hover:text-emerald-700" : "text-rose-600 hover:text-rose-700"
                            }`}
                          >
                            {isPaid ? "Оплачено" : "Не оплачено"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Продажа: форма бронирования урока */
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs max-w-xl mx-auto panel-card-stack ${pageTabPanelCls(activeTab, "view")}`}
        >
          <div className="panel-form-header">
            <div className="panel-form-header-icon">
              <Ticket className="w-5 h-5 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">Продажа персонального урока</h2>
            <p className="text-slate-400 text-[11px] leading-snug">
              Оформите бронирование персонального урока — запись сразу попадёт в календарь.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setPackageModalOpen(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-[10px] font-sans font-semibold uppercase tracking-wider transition-colors cursor-pointer"
          >
            <Ticket className="w-3.5 h-3.5" />
            Продать пакет уроков
          </button>

          <div className="panel-form-stack">
            <DisciplineSelect
              disciplines={disciplines}
              value={disciplineId}
              onChange={setDisciplineId}
              toast={toast}
            />

            <div className="field-stack">
              {bookingClients.map((client, idx) => (
                <div key={idx} className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    {packageLocked ? (
                      <div className="field-stack">
                        <label className={labelCls}>{idx === 0 ? "Имя Фамилия" : `Клиент ${idx + 1}`}</label>
                        <input
                          type="text"
                          readOnly
                          value={client.query}
                          className="w-full bg-slate-100 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm text-slate-600 cursor-not-allowed"
                        />
                      </div>
                    ) : (
                      <ClientAutocomplete
                        label={idx === 0 ? "Имя Фамилия" : `Клиент ${idx + 1}`}
                        clients={clients}
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
                        onSelect={(c) => {
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
                      onClick={() => handleRemoveBookingClient(idx)}
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
                  ＋ Добавить ещё клиента
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 pt-1.5 -mt-1" />

            <div className="grid grid-cols-2 gap-3">
              <div className="field-stack">
                <label className={labelCls}>Время начала</label>
                <input
                  type="time"
                  required
                  value={timeStart}
                  onChange={(e) => setTimeStart(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2 text-sm transition-all font-sans"
                />
              </div>
              <div className="field-stack">
                <label className={labelCls}>Время окончания</label>
                <input
                  type="time"
                  required
                  value={timeEnd}
                  onChange={(e) => setTimeEnd(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2 text-sm transition-all font-sans"
                />
              </div>
            </div>

            {/* Multi-date controls */}
            <div>
              <div className="field-stack">
                <label className={labelCls}>Даты бронирования</label>
                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                  {dates.map((dateStr, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="date"
                        required
                        value={dateStr}
                        onChange={(e) => handleDateChange(idx, e.target.value)}
                        className="flex-1 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2 text-sm transition-all font-sans"
                      />
                      <button
                        type="button"
                        disabled={dates.length <= 1}
                        onClick={() => handleRemoveDate(idx)}
                        aria-label="Убрать дату"
                        className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddDate}
                className="w-full mt-2 py-2 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer"
              >
                ＋ Добавить дату
              </button>
            </div>

            <div className="panel-form-divider" />

            <div className="field-stack">
              <label className={labelCls}>Способ оплаты</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => selectBookingPaymentMode("single")}
                  className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider transition-colors cursor-pointer ${
                    bookingPaymentMode === "single"
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                      : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                  }`}
                >
                  ОДИН УРОК
                </button>
                <button
                  type="button"
                  onClick={() => selectBookingPaymentMode("package")}
                  className={`py-3 px-4 rounded-lg border font-sans text-xs font-semibold uppercase tracking-wider leading-snug transition-colors cursor-pointer ${
                    bookingPaymentMode === "package"
                      ? "bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-xs"
                      : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                  }`}
                >
                  СПИСАТЬ С ПАКЕТА УРОКОВ
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
                      const id = parseInt(e.target.value, 10);
                      if (!Number.isNaN(id)) applyLessonTariff(id);
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
                  <label className={labelCls.replace(" block", "")}>Стоимость за 1 урок</label>
                  <div className="relative font-sans">
                    <input
                      type="number"
                      placeholder="0"
                      value={customPrice}
                      onChange={(e) => setCustomPrice(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg pl-3.5 pr-10 py-2.5 text-sm transition-all font-semibold"
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-sans font-normal pointer-events-none">₫</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleBook(true)}
                    disabled={addPersonalLessons.isPending}
                    className="py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                  >
                    БРОНЬ С ОПЛАТОЙ
                  </button>
                  <button
                    type="button"
                    onClick={() => handleBook(false)}
                    disabled={addPersonalLessons.isPending}
                    className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                  >
                    БРОНЬ БЕЗ ОПЛАТЫ
                  </button>
                </div>
              </>
            )}

            {bookingPaymentMode === "package" && (
              <>
                {availablePrivateSubs.length > 0 ? (
                  <AppSelect
                    label="Списать с пакета"
                    value={linkedSubscriptionId}
                    onChange={(e) => {
                      const subId = e.target.value;
                      setLinkedSubscriptionId(subId);
                      if (subId) {
                        applySubscriptionToBooking(subId);
                      }
                    }}
                  >
                    <option value="">Выберите пакет...</option>
                    {availablePrivateSubs.map((s) => {
                      const label = prices.find((p) => p.id === s.priceId);
                      return (
                        <option key={s.id} value={s.id}>
                          {subscriptionOwnerLabel(s)} — {label ? getPriceLabel(label) : "Пакет"} — осталось {s.lessonsLeft} из {s.lessonsTotal}
                        </option>
                      );
                    })}
                  </AppSelect>
                ) : (
                  <p className="text-xs text-slate-400 font-sans">Нет активных пакетов с оставшимися уроками.</p>
                )}

                {linkedSubscriptionId && (
                  <p className="text-[10px] text-violet-600 font-sans">
                    Клиенты зафиксированы по пакету. Чтобы изменить состав, выберите «Один урок».
                  </p>
                )}

                <button
                  type="button"
                  onClick={() => handleBook(false)}
                  disabled={addPersonalLessons.isPending || !linkedSubscriptionId}
                  className="w-full py-3 bg-violet-600 hover:bg-violet-700 text-white font-sans text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
                >
                  {addPersonalLessons.isPending ? "Оформление..." : "БРОНЬ ПО ПАКЕТУ"}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <SellPackageModal
        open={packageModalOpen}
        onClose={() => setPackageModalOpen(false)}
        toast={toast}
        clients={clients}
        disciplines={disciplines}
        prices={prices}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить бронь персонального урока?"
        description={
          deleteTarget ? (
            <>
              Урок <strong className="font-semibold text-slate-800">{renderClientNames(deleteTarget)}</strong> от{" "}
              {formatDateLabel(deleteTarget.date)} будет удалён безвозвратно.
            </>
          ) : (
            ""
          )
        }
        confirmLabel="Удалить"
        pending={deletePersonalLesson.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <AnimatePresence>
        {editTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditTarget(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs"
            />
            <motion.div
              initial={{ scale: 0.97, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="relative bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden max-w-sm w-full p-4 panel-card-stack"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="text-base font-semibold tracking-tight text-slate-900">Редактировать урок</h3>
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  aria-label="Закрыть"
                  className="p-1 text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="panel-form-stack font-sans">
                <div className="field-stack">
                  <label className={labelCls}>Дата</label>
                  <input
                    type="date"
                    required
                    value={editDate}
                    onChange={(e) => setEditDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="field-stack">
                    <label className={labelCls}>Начало</label>
                    <input
                      type="time"
                      required
                      value={editTimeStart}
                      onChange={(e) => setEditTimeStart(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2 text-sm transition-all font-sans"
                    />
                  </div>
                  <div className="field-stack">
                    <label className={labelCls}>Окончание</label>
                    <input
                      type="time"
                      required
                      value={editTimeEnd}
                      onChange={(e) => setEditTimeEnd(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2 text-sm transition-all font-sans"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-1 text-xs">
                <button
                  type="button"
                  onClick={handleSaveEditLesson}
                  disabled={updatePersonalLesson.isPending}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer disabled:opacity-60"
                >
                  {updatePersonalLesson.isPending ? "..." : "Сохранить"}
                </button>
                <button
                  type="button"
                  onClick={() => setEditTarget(null)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold uppercase tracking-wider font-sans rounded-lg transition-colors cursor-pointer"
                >
                  Отмена
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
