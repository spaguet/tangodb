/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Search, FolderClosed, Trash2, BadgePlus, X, CalendarDays } from "lucide-react";
import { useClients } from "../hooks/useClients";
import { usePrices } from "../hooks/usePrices";
import { formatClientName, formatCurrency } from "../lib/utils";
import {
  useAddPersonalLessons,
  useDeletePersonalLesson,
  usePersonalLessons,
  useUpdatePersonalPaid,
} from "../hooks/usePersonalLessons";
import { useUIStore } from "../store/ui";
import ClientAutocomplete from "./ui/ClientAutocomplete";
import ConfirmDialog from "./ui/ConfirmDialog";
import LoadingState from "./ui/LoadingState";
import PageTabs, { pageTabPanelCls } from "./ui/PageTabs";
import type { ToastType } from "../App";
import type { Client, PersonalLesson } from "../types";

interface PersonalLessonsPanelProps {
  initialTab?: "view" | "book";
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

const toggleCls = (selected: boolean) =>
  `py-2.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer text-center ${
    selected
      ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-semibold"
      : "border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700"
  }`;

export default function PersonalLessonsPanel({
  initialTab = "view",
  toast,
}: PersonalLessonsPanelProps) {
  const navigate = useNavigate();
  const setPersonalTab = useUIStore((s) => s.setPersonalTab);

  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const { data: personalLessons = [], isLoading: lessonsLoading } = usePersonalLessons();
  const { data: prices = [], isLoading: pricesLoading } = usePrices();
  const addPersonalLessons = useAddPersonalLessons();
  const updatePersonalPaid = useUpdatePersonalPaid();
  const deletePersonalLesson = useDeletePersonalLesson();

  const isLoading = clientsLoading || lessonsLoading || pricesLoading;

  const [activeTab, setActiveTab] = useState<"book" | "view">(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const switchTab = (tab: "view" | "book") => {
    setActiveTab(tab);
    setPersonalTab(tab);
    navigate(tab === "book" ? "/personal/book" : "/personal");
  };

  // Browse filters
  const [pvFilter, setPvFilter] = useState<"all" | "yes" | "no">("all");
  const [search, setSearch] = useState("");

  // Booking form states
  const [pType, setPType] = useState<"solo" | "pair" | "trio">("solo");
  const [dates, setDates] = useState<string[]>([""]);
  const [customPrice, setCustomPrice] = useState("");

  const [c1Query, setC1Query] = useState("");
  const [c1Id, setC1Id] = useState("");
  const [c2Query, setC2Query] = useState("");
  const [c2Id, setC2Id] = useState("");
  const [c3Query, setC3Query] = useState("");
  const [c3Id, setC3Id] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<PersonalLesson | null>(null);

  // Pricing helper
  const pullStandardPrice = () => {
    const key = `personal_${pType}`;
    const matched = prices.find((p) => p.type.trim() === key);
    if (matched) {
      setCustomPrice(matched.price.toString());
      toast(`Подставлен стандартный тариф: ${formatCurrency(matched.price)}`, "success");
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
      toast("Выберите главного клиента из списка.", "error");
      return;
    }
    if ((pType === "pair" || pType === "trio") && (!c2Query || !c2Id)) {
      toast("Выберите второго участника.", "error");
      return;
    }
    if (pType === "trio" && (!c3Query || !c3Id)) {
      toast("Выберите третьего участника.", "error");
      return;
    }

    const filteredDates = dates.filter((d) => d !== "");
    if (filteredDates.length === 0) {
      toast("Выберите хотя бы одну дату бронирования.", "error");
      return;
    }

    const priceNum = parseFloat(customPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      toast("Укажите корректную стоимость урока.", "error");
      return;
    }

    const payload = {
      type: pType,
      clientId1: c1Id,
      clientId2: pType === "pair" || pType === "trio" ? c2Id : "",
      clientId3: pType === "trio" ? c3Id : "",
      dates: filteredDates,
      price: priceNum,
      paid: immediatePaid,
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
      setPType("solo");
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

  const currentYearMonth = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  })();

  const isCurrentMonth = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return key === currentYearMonth;
  };

  const currentMonthLessons = personalLessons.filter((l) => isCurrentMonth(l.date));
  const monthLessonCount = currentMonthLessons.length;
  const monthPaidCount = currentMonthLessons.filter((l) => l.paid === "yes").length;
  const totalUnpaidSum = personalLessons.filter((l) => l.paid === "no").reduce((sum, l) => sum + l.price, 0);

  const clientMap = clients.reduce(
    (acc, c) => ({ ...acc, [String(c.id)]: c }),
    {} as Record<string, Client>
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
    .filter((l) => pvFilter === "all" || l.paid === pvFilter)
    .filter((l) => {
      if (!search.trim()) return true;
      const c1Str = clientNameFromMap(l.clientId1);
      const c2Str = l.clientId2 ? clientNameFromMap(l.clientId2) : "";
      const c3Str = l.clientId3 ? clientNameFromMap(l.clientId3) : "";
      return `${c1Str} ${c2Str} ${c3Str}`.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const groupLessonsByMonth = () => {
    const groups: Record<string, { label: string; items: PersonalLesson[] }> = {};
    filteredLessons.forEach((l) => {
      const d = new Date(l.date + "T12:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("ru-RU", { month: "long", year: "numeric" });
      if (!groups[key]) {
        groups[key] = { label, items: [] };
      }
      groups[key].items.push(l);
    });
    return Object.keys(groups)
      .sort((a, b) => b.localeCompare(a))
      .map((key) => ({ key, ...groups[key] }));
  };

  const monthlyGroups = groupLessonsByMonth();

  if (isLoading) return <LoadingState label="Загрузка персональных уроков..." />;

  const personalTabs = [
    { id: "view", label: "Просмотр", icon: FolderClosed },
    { id: "book", label: "Продажа", icon: BadgePlus },
  ] as const;

  return (
    <div>
      <PageTabs tabs={[...personalTabs]} activeTab={activeTab} onChange={switchTab} />

      {activeTab === "view" ? (
        /* SCREEN 1: BROWSE PRIVATE SESSIONS */
        <div className="panel-page-stack">
          <div className="bg-white rounded-b-xl rounded-tr-xl border border-slate-200 border-t-0 shadow-xs overflow-hidden -mt-px">
            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-200/70">
              <div className="px-4 py-2.5">
                <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">Уроки в этом месяце</p>
                <h4 className="text-xl font-semibold text-slate-800 mt-0.5 leading-none">{monthLessonCount}</h4>
              </div>
              <div className="px-4 py-2.5">
                <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">Оплаченных в этом месяце</p>
                <h4 className="text-xl font-semibold text-emerald-700 mt-0.5 leading-none">{monthPaidCount}</h4>
              </div>
              <div className="px-4 py-2.5">
                <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold leading-tight">Ожидает оплаты</p>
                <h4 className="text-xl font-sans font-semibold text-rose-700 mt-0.5 leading-none">{formatCurrency(totalUnpaidSum)}</h4>
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
                  placeholder="Поиск по имени ученика..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg text-xs transition-all"
                />
              </div>
            </div>

            {monthlyGroups.length === 0 ? (
              <div className="text-center py-20 text-slate-400 space-y-3">
                <Sparkles className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm">Персональных уроков с такими критериями нет.</p>
                <button
                  onClick={() => switchTab("book")}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                >
                  Забронировать урок →
                </button>
              </div>
            ) : (
              <div className="panel-card-stack">
                {monthlyGroups.map((group) => {
                  const groupSum = group.items.reduce((s, x) => s + x.price, 0);
                  const isUnpaidInGroup = group.items.some((x) => x.paid === "no");

                  return (
                    <div key={group.key} className="panel-card-stack">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="text-xs font-sans font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md">
                          {group.label}
                        </span>
                        <span className="text-xs font-sans text-slate-400 font-semibold">
                          Итого: {formatCurrency(groupSum)}
                          {isUnpaidInGroup && <span className="text-rose-600 font-sans ml-2">(есть долг)</span>}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {group.items.map((l) => {
                          const isPaid = l.paid === "yes";
                          const isUpcoming = isUpcomingLesson(l.date);

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
                                  </span>
                                  <span className="inline-flex items-center gap-1 font-sans text-xs text-slate-400">
                                    <CalendarDays className="w-3 h-3" />
                                    {formatDateLabel(l.date)}
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
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
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
              <label className={labelCls}>Участники</label>
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

            <ClientAutocomplete
              label="Главный ученик"
              clients={clients}
              query={c1Query}
              selectedId={c1Id}
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
                  label="Второй ученик"
                  clients={clients}
                  query={c2Query}
                  selectedId={c2Id}
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
                  label="Третий ученик"
                  clients={clients}
                  query={c3Query}
                  selectedId={c3Id}
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

            {/* Multi-date controls */}
            <div className="space-y-0.5">
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
              <button
                type="button"
                onClick={handleAddDate}
                className="w-full py-1.5 bg-slate-50 border border-dashed border-slate-300 hover:border-slate-400 rounded-lg text-slate-600 hover:bg-slate-100 transition-colors font-sans text-xs font-semibold uppercase tracking-wider cursor-pointer"
              >
                ＋ Добавить дату
              </button>
            </div>

            <div className="panel-form-divider" />

            <div className="field-stack">
              <div className="flex items-center justify-between">
                <label className={labelCls.replace(" block", "")}>Стоимость за 1 урок</label>
                <button
                  type="button"
                  onClick={pullStandardPrice}
                  className="text-[11px] text-indigo-600 hover:text-indigo-700 hover:underline font-sans font-semibold uppercase cursor-pointer"
                >
                  Взять из прайса
                </button>
              </div>

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
