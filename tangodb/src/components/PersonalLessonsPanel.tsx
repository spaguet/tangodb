/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Search, FolderClosed, Trash2, BadgePlus, X, CalendarDays, ChevronLeft, ChevronRight, Ticket } from "lucide-react";
import { useClients } from "../hooks/useClients";
import { useDisciplines } from "../hooks/useDisciplines";
import { usePrices } from "../hooks/usePrices";
import {
  deriveSubscriptionTypeFromTariff,
  formatClientName,
  formatCurrency,
  getPriceLabel,
  getPrivateLessonTariffs,
  getPrivatePackageTariffs,
  tariffNeedsSecondClient,
  tariffNeedsThirdClient,
  tariffParticipantType,
} from "../lib/utils";
import {
  useAddPersonalLessons,
  useDeletePersonalLesson,
  usePersonalLessons,
  useUpdatePersonalPaid,
} from "../hooks/usePersonalLessons";
import { useAddSubscription, useSubscriptions } from "../hooks/useSubscriptions";
import { useUIStore } from "../store/ui";
import ClientAutocomplete from "./ui/ClientAutocomplete";
import ConfirmDialog from "./ui/ConfirmDialog";
import DisciplineSelect from "./ui/DisciplineSelect";
import LoadingState from "./ui/LoadingState";
import PageTabs, { pageTabPanelCls } from "./ui/PageTabs";
import type { ToastType } from "../App";
import type { Client, PersonalLesson } from "../types";

interface PersonalLessonsPanelProps {
  initialTab?: "view" | "book" | "sell";
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

const toggleCls = (selected: boolean) =>
  `py-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer text-center ${
    selected
      ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold"
      : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
  }`;

function currentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function lessonYearMonth(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthTitle(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  const date = new Date(y, m - 1, 1);
  return date.toLocaleString("ru-RU", { month: "long", year: "numeric" });
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

  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const { data: disciplines = [], isLoading: disciplinesLoading } = useDisciplines();
  const { data: personalLessons = [], isLoading: lessonsLoading } = usePersonalLessons();
  const { data: prices = [], isLoading: pricesLoading } = usePrices();
  const { data: subscriptions = [] } = useSubscriptions();
  const addPersonalLessons = useAddPersonalLessons();
  const addSubscription = useAddSubscription();
  const updatePersonalPaid = useUpdatePersonalPaid();
  const deletePersonalLesson = useDeletePersonalLesson();

  const isLoading = clientsLoading || disciplinesLoading || lessonsLoading || pricesLoading;

  const [activeTab, setActiveTab] = useState<"view" | "book" | "sell">(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const switchTab = (tab: "view" | "book" | "sell") => {
    setActiveTab(tab);
    setPersonalTab(tab);
    if (tab === "book") navigate("/personal/book");
    else if (tab === "sell") navigate("/personal/sell");
    else navigate("/personal");
  };

  // Browse filters
  const [viewMonth, setViewMonth] = useState(currentYearMonth);
  const [pvFilter, setPvFilter] = useState<"all" | "yes" | "no">("all");
  const [search, setSearch] = useState("");

  // Booking form states
  const [pType, setPType] = useState<"solo" | "pair" | "trio">("solo");
  const [dates, setDates] = useState<string[]>([""]);
  const [timeStart, setTimeStart] = useState("14:00");
  const [timeEnd, setTimeEnd] = useState("15:00");
  const [customPrice, setCustomPrice] = useState("");
  const [selectedLessonTariffId, setSelectedLessonTariffId] = useState<number | "">("");
  const [linkedSubscriptionId, setLinkedSubscriptionId] = useState("");

  // Personal subscription sale
  const packageTariffs = getPrivatePackageTariffs(prices);
  const lessonTariffs = getPrivateLessonTariffs(prices);
  const [selectedPackageTariffId, setSelectedPackageTariffId] = useState<number | "">("");
  const [subClient1Query, setSubClient1Query] = useState("");
  const [subClient1Id, setSubClient1Id] = useState("");
  const [subClient2Query, setSubClient2Query] = useState("");
  const [subClient2Id, setSubClient2Id] = useState("");
  const [subClient3Query, setSubClient3Query] = useState("");
  const [subClient3Id, setSubClient3Id] = useState("");
  const [subDisciplineId, setSubDisciplineId] = useState<number | "">("");
  const [subActivationDate, setSubActivationDate] = useState("");

  useEffect(() => {
    if (packageTariffs.length > 0 && selectedPackageTariffId === "") {
      setSelectedPackageTariffId(packageTariffs[0].id!);
    }
    if (lessonTariffs.length > 0 && selectedLessonTariffId === "") {
      const match = lessonTariffs.find((p) => p.type.trim() === `personal_${pType}`);
      setSelectedLessonTariffId(match?.id ?? lessonTariffs[0].id!);
    }
  }, [packageTariffs, lessonTariffs, selectedPackageTariffId, selectedLessonTariffId, pType]);

  useEffect(() => {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setSubActivationDate(`${today.getFullYear()}-${mm}-${dd}`);
  }, []);

  useEffect(() => {
    if (disciplines.length > 0 && subDisciplineId === "") {
      setSubDisciplineId(disciplines[0].id);
    }
  }, [disciplines, subDisciplineId]);

  const selectedPackageTariff = packageTariffs.find((p) => p.id === selectedPackageTariffId);
  const selectedLessonTariff = lessonTariffs.find((p) => p.id === selectedLessonTariffId);
  const packageNeedsSecond = selectedPackageTariff ? tariffNeedsSecondClient(selectedPackageTariff) : false;
  const packageNeedsThird = selectedPackageTariff ? tariffNeedsThirdClient(selectedPackageTariff) : false;

  const clientPrivateSubs = subscriptions.filter(
    (s) =>
      s.category === "private" &&
      s.status === "active" &&
      s.lessonsLeft > 0 &&
      (s.clientId1 === c1Id || s.clientId2 === c1Id)
  );

  const [c1Query, setC1Query] = useState("");
  const [c1Id, setC1Id] = useState("");
  const [c2Query, setC2Query] = useState("");
  const [c2Id, setC2Id] = useState("");
  const [c3Query, setC3Query] = useState("");
  const [c3Id, setC3Id] = useState("");
  const [disciplineId, setDisciplineId] = useState<number | "">("");

  useEffect(() => {
    if (disciplines.length > 0 && disciplineId === "") {
      setDisciplineId(disciplines[0].id);
    }
  }, [disciplines, disciplineId]);

  const [deleteTarget, setDeleteTarget] = useState<PersonalLesson | null>(null);

  // Pricing helper
  const applyLessonTariff = (tariffId: number) => {
    const matched = lessonTariffs.find((p) => p.id === tariffId);
    if (matched) {
      setSelectedLessonTariffId(tariffId);
      setCustomPrice(matched.price.toString());
      const participant = tariffParticipantType(matched);
      setPType(participant);
      toast(`Тариф: ${getPriceLabel(matched)} — ${formatCurrency(matched.price)}`, "success");
    }
  };

  const pullStandardPrice = () => {
    const match =
      lessonTariffs.find((p) => p.id === selectedLessonTariffId) ??
      lessonTariffs.find((p) => p.type.trim() === `personal_${pType}`);
    if (match?.id) {
      applyLessonTariff(match.id);
    } else {
      toast("Тариф для этой конфигурации ещё не настроен", "error");
    }
  };

  // Multiple date controls
  const handleAddDate = () => setDates([...dates, ""]);

  const handleRemoveDate = (index: number) => {
    if (dates.length <= 1) return;
    setDates(dates.filter((_, i) => i !== index));
  };

  const handleDateChange = (index: number, val: string) => {
    const next = [...dates];
    next[index] = val;
    setDates(next);
  };

  const handleBook = async (immediatePaid: boolean) => {
    if (!c1Query || !c1Id) {
      toast("Выберите первого клиента из списка.", "error");
      return;
    }
    if ((pType === "pair" || pType === "trio") && (!c2Query || !c2Id)) {
      toast("Выберите второго клиента.", "error");
      return;
    }
    if (pType === "trio" && (!c3Query || !c3Id)) {
      toast("Выберите третьего клиента.", "error");
      return;
    }
    if (!disciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }

    const filteredDates = dates.filter((d) => d !== "");
    if (filteredDates.length === 0) {
      toast("Выберите хотя бы одну дату бронирования.", "error");
      return;
    }

    const priceNum = linkedSubscriptionId ? 0 : parseFloat(customPrice);
    if (!linkedSubscriptionId && (isNaN(priceNum) || priceNum < 0)) {
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

    const payload = {
      type: pType,
      clientId1: c1Id,
      clientId2: pType === "pair" || pType === "trio" ? c2Id : "",
      clientId3: pType === "trio" ? c3Id : "",
      dates: filteredDates,
      timeStart,
      timeEnd,
      price: priceNum,
      paid: immediatePaid,
      disciplineId: disciplineId as number,
      subscriptionId: linkedSubscriptionId || undefined,
    };

    const res = await addPersonalLessons.mutateAsync(payload);
    if (!res.success) {
      toast(res.error || "Не удалось забронировать", "error");
    } else {
      toast(
        immediatePaid ? "Забронировано и оплачено" : "Внесено в календарь как неоплаченная бронь",
        "success"
      );
      setC1Query("");
      setC1Id("");
      setC2Query("");
      setC2Id("");
      setC3Query("");
      setC3Id("");
      setDates([""]);
      setCustomPrice("");
      setLinkedSubscriptionId("");
      setTimeStart("14:00");
      setTimeEnd("15:00");
      setPType("solo");
    }
  };

  const handleSellPersonalSub = async () => {
    if (!selectedPackageTariff?.id) {
      toast("Выберите тариф абонемента.", "error");
      return;
    }
    if (!subClient1Query || !subClient1Id) {
      toast("Выберите клиента из списка.", "error");
      return;
    }
    if (packageNeedsSecond && (!subClient2Query || !subClient2Id)) {
      toast("Выберите второго клиента.", "error");
      return;
    }
    if (packageNeedsThird && (!subClient3Query || !subClient3Id)) {
      toast("Выберите третьего клиента.", "error");
      return;
    }
    if (!subDisciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }
    if (!subActivationDate) {
      toast("Укажите дату активации.", "error");
      return;
    }

    const { type, pairMonth } = deriveSubscriptionTypeFromTariff(selectedPackageTariff);
    const res = await addSubscription.mutateAsync({
      type,
      clientId1: subClient1Id,
      clientId2: packageNeedsSecond ? subClient2Id : "",
      lessonsTotal: selectedPackageTariff.lessons,
      activationDate: subActivationDate,
      pairMonth,
      disciplineId: subDisciplineId as number,
      priceId: selectedPackageTariff.id,
      category: "private",
    });

    if (!res.success) {
      toast(res.error || "Не удалось оформить абонемент", "error");
    } else {
      toast("Персональный абонемент продан", "success");
      setSubClient1Query("");
      setSubClient1Id("");
      setSubClient2Query("");
      setSubClient2Id("");
      setSubClient3Query("");
      setSubClient3Id("");
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

  const isViewingCurrentMonth = viewMonth === currentYearMonth();
  const monthLessons = personalLessons.filter((l) => lessonYearMonth(l.date) === viewMonth);
  const monthLessonCount = monthLessons.length;
  const monthPaidCount = monthLessons.filter((l) => l.paid === "yes").length;
  const monthUnpaidSum = monthLessons.filter((l) => l.paid === "no").reduce((sum, l) => sum + l.price, 0);

  const clientMap = clients.reduce(
    (acc, c) => ({ ...acc, [String(c.id)]: c }),
    {} as Record<string, Client>
  );
  const disciplineMap = disciplines.reduce(
    (acc, d) => ({ ...acc, [d.id]: d }),
    {} as Record<number, (typeof disciplines)[0]>
  );

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
    .sort((a, b) => a.date.localeCompare(b.date) || a.timeStart.localeCompare(b.timeStart));

  const monthTotalSum = filteredLessons.reduce((s, l) => s + l.price, 0);
  const hasUnpaidInView = filteredLessons.some((l) => l.paid === "no");

  if (isLoading) return <LoadingState label="Загрузка персональных уроков..." />;

  const personalTabs = [
    { id: "view", label: "Просмотр", icon: FolderClosed },
    { id: "book", label: "Урок", icon: BadgePlus },
    { id: "sell", label: "Абонемент", icon: Ticket },
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
                <span className="text-sm font-semibold text-slate-800 capitalize">{formatMonthTitle(viewMonth)}</span>
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
                    ? `В ${formatMonthTitle(viewMonth)} персональных уроков нет.`
                    : "Персональных уроков с такими критериями нет."}
                </p>
                <button
                  onClick={() => switchTab("book")}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                >
                  Забронировать урок →
                </button>
              </div>
            ) : (
              <div className="panel-card-stack">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <span className="text-xs font-sans font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md capitalize">
                    {formatMonthTitle(viewMonth)}
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
                    const disciplineName =
                      l.disciplineId != null ? disciplineMap[l.disciplineId]?.name : undefined;

                    return (
                      <div
                        key={l.id}
                        className={`border rounded-xl p-4 flex items-center justify-between gap-4 transition-all hover:shadow-sm ${
                          isUpcoming
                            ? "bg-emerald-50 border-emerald-200"
                            : isPaid
                              ? "bg-white border-slate-200"
                              : "bg-white border-rose-200"
                        }`}
                      >
                        <div className="space-y-1 flex-1 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-sans tracking-wider font-semibold uppercase bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                              {l.type === "solo" ? "Соло" : l.type === "pair" ? "Парный" : "Трио"}
                              {disciplineName ? ` · ${disciplineName}` : ""}
                            </span>
                            <span className="inline-flex items-center gap-1 font-sans text-xs text-slate-400">
                              <CalendarDays className="w-3 h-3" />
                              {formatDateLabel(l.date)} · {l.timeStart} – {l.timeEnd}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-slate-800 leading-tight">{renderClientNames(l)}</p>
                          <p className="font-sans text-xs font-semibold text-slate-500">{formatCurrency(l.price)}</p>
                        </div>

                        <div className="flex flex-col items-end gap-2">
                          <button
                            onClick={() => handleTogglePaid(l)}
                            disabled={updatePersonalPaid.isPending}
                            title={isPaid ? "Нажмите, чтобы отменить оплату" : "Нажмите, чтобы подтвердить оплату"}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-sans font-semibold transition-colors cursor-pointer select-none border disabled:opacity-60 ${
                              isPaid
                                ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                : "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
                            }`}
                          >
                            {isPaid ? "Оплачен" : "К оплате"}
                          </button>

                          <button
                            onClick={() => setDeleteTarget(l)}
                            className="p-1.5 text-slate-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Удалить"
                            aria-label="Удалить бронь"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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
      ) : activeTab === "book" ? (
        /* SCREEN 2: PRIVATE LESSON BOOKING FORM */
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs max-w-xl mx-auto panel-card-stack ${pageTabPanelCls(activeTab, "view")}`}
        >
          <div className="panel-form-header">
            <div className="panel-form-header-icon">
              <Sparkles className="w-5 h-5 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">Забронировать персональный урок</h2>
            <p className="text-slate-400 text-[11px] leading-snug">
              Можно зарезервировать сразу несколько дат за одно оформление.
            </p>
          </div>

          <div className="panel-form-stack">
            <div className="field-stack">
              <label className={labelCls}>Клиенты</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: "solo", label: "Соло" },
                  { key: "pair", label: "Пара" },
                  { key: "trio", label: "Трио" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setPType(item.key as "solo" | "pair" | "trio");
                      if (item.key === "solo") {
                        setC2Id("");
                        setC2Query("");
                        setC3Id("");
                        setC3Query("");
                      }
                      if (item.key === "pair") {
                        setC3Id("");
                        setC3Query("");
                      }
                    }}
                    className={toggleCls(pType === item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <DisciplineSelect
              disciplines={disciplines}
              value={disciplineId}
              onChange={setDisciplineId}
              toast={toast}
            />

            <ClientAutocomplete
              label="Первый клиент"
              clients={clients}
              query={c1Query}
              selectedId={c1Id}
              showAddClientButton
              toast={toast}
              onQueryChange={(q) => {
                setC1Query(q);
                setC1Id("");
              }}
              onSelect={(c) => {
                setC1Id(c.id);
                setC1Query(`${c.lastName} ${c.firstName}`);
              }}
            />

            {(pType === "pair" || pType === "trio") && (
              <div className="animate-fade-in">
                <ClientAutocomplete
                  label="Второй клиент"
                  clients={clients}
                  query={c2Query}
                  selectedId={c2Id}
                  showAddClientButton
                  toast={toast}
                  onQueryChange={(q) => {
                    setC2Query(q);
                    setC2Id("");
                  }}
                  onSelect={(c) => {
                    setC2Id(c.id);
                    setC2Query(`${c.lastName} ${c.firstName}`);
                  }}
                />
              </div>
            )}

            {pType === "trio" && (
              <div className="animate-fade-in">
                <ClientAutocomplete
                  label="Третий клиент"
                  clients={clients}
                  query={c3Query}
                  selectedId={c3Id}
                  showAddClientButton
                  toast={toast}
                  onQueryChange={(q) => {
                    setC3Query(q);
                    setC3Id("");
                  }}
                  onSelect={(c) => {
                    setC3Id(c.id);
                    setC3Query(`${c.lastName} ${c.firstName}`);
                  }}
                />
              </div>
            )}

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
                        className="p-2 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <X className="w-4 h-4" />
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

            {clientPrivateSubs.length > 0 && (
              <div className="field-stack">
                <label className={labelCls}>Списать с абонемента</label>
                <select
                  value={linkedSubscriptionId}
                  onChange={(e) => {
                    setLinkedSubscriptionId(e.target.value);
                    if (e.target.value) setCustomPrice("0");
                  }}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all font-sans"
                >
                  <option value="">Разовый урок (без абонемента)</option>
                  {clientPrivateSubs.map((s) => {
                    const label = prices.find((p) => p.id === s.priceId);
                    return (
                      <option key={s.id} value={s.id}>
                        {label ? getPriceLabel(label) : "Абонемент"} — осталось {s.lessonsLeft} из {s.lessonsTotal}
                      </option>
                    );
                  })}
                </select>
              </div>
            )}

            {!linkedSubscriptionId && lessonTariffs.length > 0 && (
              <div className="field-stack">
                <label className={labelCls}>Тариф за урок</label>
                <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                  {lessonTariffs.map((tariff) => (
                    <button
                      key={tariff.id}
                      type="button"
                      onClick={() => applyLessonTariff(tariff.id!)}
                      className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer ${
                        selectedLessonTariffId === tariff.id
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <p className="text-xs font-semibold text-slate-800">{getPriceLabel(tariff)}</p>
                      <p className="text-[10px] text-slate-400 font-sans">{formatCurrency(tariff.price)}</p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="field-stack">
              <div className="flex items-center justify-between">
                <label className={labelCls.replace(" block", "")}>Стоимость за 1 урок</label>
                {!linkedSubscriptionId && (
                  <button
                    type="button"
                    onClick={pullStandardPrice}
                    className="text-[11px] text-indigo-600 hover:text-indigo-700 hover:underline font-sans font-semibold uppercase cursor-pointer"
                  >
                    Взять из прайса
                  </button>
                )}
              </div>

              <div className="relative font-sans">
                <input
                  type="number"
                  placeholder="0"
                  value={linkedSubscriptionId ? "0" : customPrice}
                  disabled={!!linkedSubscriptionId}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg pl-3.5 pr-10 py-2.5 text-sm transition-all font-semibold disabled:opacity-60"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-sans font-normal pointer-events-none">₫</span>
              </div>
              {linkedSubscriptionId && (
                <p className="text-[10px] text-violet-600 font-sans">Урок будет списан с абонемента в журнале посещений.</p>
              )}
            </div>

            <div className="panel-form-divider" />

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => handleBook(true)}
                disabled={addPersonalLessons.isPending}
                className="py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-sans text-xs font-semibold leading-tight rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
              >
                Бронь с
                <br />
                оплатой
              </button>

              <button
                onClick={() => handleBook(false)}
                disabled={addPersonalLessons.isPending}
                className="py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-sans text-xs font-semibold leading-tight rounded-lg transition-colors cursor-pointer disabled:opacity-60"
              >
                Бронь
                <br />
                без оплаты
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs max-w-xl mx-auto panel-card-stack ${pageTabPanelCls(activeTab, "view")}`}
        >
          <div className="panel-form-header">
            <div className="panel-form-header-icon">
              <Ticket className="w-5 h-5 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">Продажа персонального абонемента</h2>
            <p className="text-slate-400 text-[11px] leading-snug">
              Пакет персональных уроков — посещения отмечаются в журнале при бронировании.
            </p>
          </div>

          <div className="panel-form-stack">
            <div className="field-stack">
              <label className={labelCls}>Тариф абонемента</label>
              {packageTariffs.length === 0 ? (
                <p className="text-xs text-slate-400 font-sans">
                  Нет пакетных тарифов. Создайте персональный тариф с количеством уроков больше 1 в прайс-листе.
                </p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {packageTariffs.map((tariff) => (
                    <button
                      key={tariff.id}
                      type="button"
                      onClick={() => setSelectedPackageTariffId(tariff.id!)}
                      className={`w-full text-left p-3 rounded-lg border transition-all cursor-pointer ${
                        selectedPackageTariffId === tariff.id
                          ? "border-violet-500 bg-violet-50"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <p className="text-sm font-semibold text-slate-800">{getPriceLabel(tariff)}</p>
                      <p className="text-[11px] text-slate-400 mt-0.5 font-sans">
                        {tariff.lessons} занятий · {formatCurrency(tariff.price)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <DisciplineSelect
              disciplines={disciplines}
              value={subDisciplineId}
              onChange={setSubDisciplineId}
              toast={toast}
            />

            <ClientAutocomplete
              label={packageNeedsSecond ? "Первый клиент" : "Клиент"}
              clients={clients}
              query={subClient1Query}
              selectedId={subClient1Id}
              showAddClientButton
              toast={toast}
              onQueryChange={(q) => {
                setSubClient1Query(q);
                setSubClient1Id("");
              }}
              onSelect={(c) => {
                setSubClient1Id(c.id);
                setSubClient1Query(`${c.lastName} ${c.firstName}`);
              }}
            />

            {packageNeedsSecond && (
              <ClientAutocomplete
                label="Второй клиент"
                clients={clients}
                query={subClient2Query}
                selectedId={subClient2Id}
                showAddClientButton
                toast={toast}
                onQueryChange={(q) => {
                  setSubClient2Query(q);
                  setSubClient2Id("");
                }}
                onSelect={(c) => {
                  setSubClient2Id(c.id);
                  setSubClient2Query(`${c.lastName} ${c.firstName}`);
                }}
              />
            )}

            {packageNeedsThird && (
              <ClientAutocomplete
                label="Третий клиент"
                clients={clients}
                query={subClient3Query}
                selectedId={subClient3Id}
                showAddClientButton
                toast={toast}
                onQueryChange={(q) => {
                  setSubClient3Query(q);
                  setSubClient3Id("");
                }}
                onSelect={(c) => {
                  setSubClient3Id(c.id);
                  setSubClient3Query(`${c.lastName} ${c.firstName}`);
                }}
              />
            )}

            <div className="field-stack">
              <label className={labelCls}>Дата активации</label>
              <input
                type="date"
                required
                value={subActivationDate}
                onChange={(e) => setSubActivationDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all"
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-violet-50/60 rounded-xl border border-violet-100">
              <span className="text-slate-600 font-semibold text-sm">Итого к оплате</span>
              <span className="text-xl font-sans font-semibold text-violet-700">
                {selectedPackageTariff ? formatCurrency(selectedPackageTariff.price) : "—"}
              </span>
            </div>

            <button
              onClick={handleSellPersonalSub}
              disabled={addSubscription.isPending || packageTariffs.length === 0}
              className="w-full py-3.5 bg-violet-600 hover:bg-violet-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
            >
              {addSubscription.isPending ? "Оформление..." : "Продать абонемент"}
            </button>
          </div>
        </div>
      )}

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
    </div>
  );
}
