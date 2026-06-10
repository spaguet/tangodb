/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { Sparkles, Calendar, DollarSign, Search, FolderClosed, Trash2, CheckCircle2, ShieldAlert, BadgePlus, X } from "lucide-react";
import { Client, PersonalLesson, Price } from "../types";

interface PersonalLessonsPanelProps {
  initialTab?: "view" | "book";
  clients: Client[];
  personalLessons: PersonalLesson[];
  prices: Price[];
  onAddPersonalLessons: (lessons: {
    type: string;
    clientId1: string;
    clientId2: string;
    clientId3: string;
    dates: string[];
    price: number;
    paid: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  onUpdatePersonalPaid: (rowIndex: number, paid: boolean, id?: string) => Promise<{ success: boolean; error?: string }>;
  onDeletePersonal: (rowIndex: number, id?: string) => Promise<{ success: boolean; error?: string }>;
  toast: (msg: string) => void;
}

export default function PersonalLessonsPanel({
  initialTab = "view",
  clients,
  personalLessons,
  prices,
  onAddPersonalLessons,
  onUpdatePersonalPaid,
  onDeletePersonal,
  toast,
}: PersonalLessonsPanelProps) {
  const [activeTab, setActiveTab] = useState<"book" | "view">(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // Selection filter for browse tabs
  const [pvFilter, setPvFilter] = useState<"all" | "yes" | "no">("all");
  const [search, setSearch] = useState("");

  // Booking Form states
  const [pType, setPType] = useState<"solo" | "pair" | "trio">("solo");
  const [dates, setDates] = useState<string[]>([""]); // starts with one date field
  const [customPrice, setCustomPrice] = useState("");

  // Autocomplete suggestions
  const [c1Query, setC1Query] = useState("");
  const [c1Id, setC1Id] = useState("");
  const [c1Suggestions, setC1Suggestions] = useState<Client[]>([]);
  const [showC1, setShowC1] = useState(false);

  const [c2Query, setC2Query] = useState("");
  const [c2Id, setC2Id] = useState("");
  const [c2Suggestions, setC2Suggestions] = useState<Client[]>([]);
  const [showC2, setShowC2] = useState(false);

  const [c3Query, setC3Query] = useState("");
  const [c3Id, setC3Id] = useState("");
  const [c3Suggestions, setC3Suggestions] = useState<Client[]>([]);
  const [showC3, setShowC3] = useState(false);

  // Suggestions updates
  useEffect(() => {
    if (!c1Query.trim()) return setC1Suggestions([]);
    setC1Suggestions(clients.filter(c => `${c.firstName} ${c.lastName}`.toLowerCase().includes(c1Query.toLowerCase())).slice(0, 5));
  }, [c1Query, clients]);

  useEffect(() => {
    if (!c2Query.trim()) return setC2Suggestions([]);
    setC2Suggestions(clients.filter(c => `${c.firstName} ${c.lastName}`.toLowerCase().includes(c2Query.toLowerCase())).slice(0, 5));
  }, [c2Query, clients]);

  useEffect(() => {
    if (!c3Query.trim()) return setC3Suggestions([]);
    setC3Suggestions(clients.filter(c => `${c.firstName} ${c.lastName}`.toLowerCase().includes(c3Query.toLowerCase())).slice(0, 5));
  }, [c3Query, clients]);

  // Pricing helper
  const pullStandardPrice = () => {
    const key = `personal_${pType}`;
    const matched = prices.find(p => p.type.trim() === key);
    if (matched) {
      setCustomPrice(matched.price.toString());
      toast(`✅ Тарифная сетка: Установлен стандартный прайс ${formatCur(matched.price)}`);
    } else {
      toast("⚠️ Тариф для этой конфигурации еще не настроен");
    }
  };

  // Multiple Date controls
  const handleAddDate = () => {
    setDates([...dates, ""]);
  };

  const handleRemoveDate = (index: number) => {
    if (dates.length <= 1) return;
    setDates(dates.filter((_, i) => i !== index));
  };

  const handleDateChange = (index: number, val: string) => {
    const next = [...dates];
    next[index] = val;
    setDates(next);
  };

  const formatCur = (num: number) => {
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "VND", maximumFractionDigits: 0 })
      .format(num)
      .replace("VND", "₫");
  };

  const handleBook = async (immediatePaid: boolean) => {
    if (!c1Query || !c1Id) {
      toast("⚠️ Выберите главного клиента."); return;
    }
    if ((pType === "pair" || pType === "trio") && (!c2Query || !c2Id)) {
      toast("⚠️ Выберите второго партнера."); return;
    }
    if (pType === "trio" && (!c3Query || !c3Id)) {
      toast("⚠️ Выберите третьего партнера."); return;
    }

    const filteredDates = dates.filter(d => d !== "");
    if (filteredDates.length === 0) {
      toast("⚠️ Выберите хотя бы одну дату для бронирования классов.");
      return;
    }

    const priceNum = parseFloat(customPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      toast("⚠️ Укажите валидную стоимость урока.");
      return;
    }

    const payload = {
      type: pType,
      clientId1: c1Id,
      clientId2: (pType === "pair" || pType === "trio") ? c2Id : "",
      clientId3: pType === "trio" ? c3Id : "",
      dates: filteredDates,
      price: priceNum,
      paid: immediatePaid
    };

    toast("⏳ Резервирование в логе...");
    const res = await onAddPersonalLessons(payload);
    if (!res.success) {
      toast(`⚠️ Ошибка бронирования: ${res.error || "Неизвестная ошибка"}`);
    } else {
      toast(immediatePaid ? "🎉 Успешно забронировано и оплачено!" : "🕐 Внесено в календарь как неоплаченная бронь");
      // Reset variables
      setC1Query(""); set1Id();
      setC2Query(""); set2Id();
      setC3Query(""); set3Id();
      setDates([""]);
      setCustomPrice("");
      setPType("solo");
    }
  };

  const set1Id = () => setC1Id("");
  const set2Id = () => setC2Id("");
  const set3Id = () => setC3Id("");

  const handleTogglePaid = async (lesson: PersonalLesson) => {
    const nextStatus = lesson.paid !== "yes";
    toast("⏳ Переключение статуса...");
    const res = await onUpdatePersonalPaid(0, nextStatus, lesson.id);
    if (!res.success) {
      toast(`⚠️ Ошибка изменения статуса: ${res.error || ""}`);
    } else {
      toast(!nextStatus ? "❌ Оплата отменена" : "✅ Платеж подтвержден, зачислен в баланс");
    }
  };

  const handleDeleteLesson = async (lesson: PersonalLesson) => {
    const confirmVal = window.confirm("Вы уверены, что хотите аннулировать и полностью стереть этот приватный урок?");
    if (!confirmVal) return;

    toast("⏳ Стирание записи...");
    const res = await onDeletePersonal(0, lesson.id);
    if (!res.success) {
      toast(`⚠️ Ошибка: ${res.error || ""}`);
    } else {
      toast("🗑 Бронь приватного занятия аннулирована");
    }
  };

  // Math totals for accounting panel
  const totalCount = personalLessons.length;
  const totalPaidSum = personalLessons.filter(l => l.paid === "yes").reduce((sum, l) => sum + l.price, 0);
  const totalUnpaidCount = personalLessons.filter(l => l.paid === "no").length;
  const totalUnpaidSum = personalLessons.filter(l => l.paid === "no").reduce((sum, l) => sum + l.price, 0);

  // Clients indexing maps
  const clientMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {} as Record<string, Client>);

  // Render client text cleanly
  const renderDancersText = (lesson: PersonalLesson) => {
    const c1 = clientMap[lesson.clientId1];
    const c2 = lesson.clientId2 ? clientMap[lesson.clientId2] : null;
    const c3 = lesson.clientId3 ? clientMap[lesson.clientId3] : null;

    let text = c1 ? `${c1.lastName} ${c1.firstName[0]}.` : lesson.clientId1;
    if (c2) text += ` & ${c2.lastName} ${c2.firstName[0]}.`;
    if (c3) text += ` & ${c3.lastName} ${c3.firstName[0]}.`;
    return text;
  };

  const formatDateLabel = (dateStr: string) => {
    const days = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
    const d = new Date(dateStr + "T12:00:00");
    return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")} (${days[d.getDay()]})`;
  };

  // Filter lessons
  const filteredLessons = personalLessons
    .filter(l => pvFilter === "all" || l.paid === pvFilter)
    .filter(l => {
      if (!search.trim()) return true;
      const c1Str = clientMap[l.clientId1] ? `${clientMap[l.clientId1].firstName} ${clientMap[l.clientId1].lastName}` : l.clientId1;
      const c2Str = l.clientId2 && clientMap[l.clientId2] ? `${clientMap[l.clientId2].firstName} ${clientMap[l.clientId2].lastName}` : "";
      const c3Str = l.clientId3 && clientMap[l.clientId3] ? `${clientMap[l.clientId3].firstName} ${clientMap[l.clientId3].lastName}` : "";
      return `${c1Str} ${c2Str} ${c3Str}`.toLowerCase().includes(search.toLowerCase());
    })
    .sort((a, b) => b.date.localeCompare(a.date)); // descending dates

  // Group lessons by Month
  const groupLessonsByMonth = () => {
    const groups: Record<string, { label: string; items: PersonalLesson[] }> = {};
    filteredLessons.forEach(l => {
      const d = new Date(l.date + "T12:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("ru-RU", { month: "long", year: "numeric" });
      if (!groups[key]) {
        groups[key] = { label, items: [] };
      }
      groups[key].items.push(l);
    });
    return Object.keys(groups).sort((a, b) => b.localeCompare(a)).map(key => ({
      key,
      ...groups[key]
    }));
  };

  const monthlyGroups = groupLessonsByMonth();

  return (
    <div className="space-y-6">
      {/* Tab Selectors header */}
      <div className="flex border-b border-stone-200">
        <button
          onClick={() => setActiveTab("view")}
          className={`px-6 py-4.5 font-serif text-base font-bold flex items-center gap-2.5 transition-all outline-none border-b-2 cursor-pointer ${
            activeTab === "view"
              ? "border-wine-800 text-wine-900"
              : "border-transparent text-stone-400 hover:text-stone-700"
          }`}
        >
          <FolderClosed className="w-5 h-5" />
          Просмотр и касса
          <span className="bg-stone-50 text-stone-500 font-mono text-xs px-2 py-0.5 rounded-full border border-stone-100">
            {personalLessons.length}
          </span>
        </button>
        <button
          onClick={() => setActiveTab("book")}
          className={`px-6 py-4.5 font-serif text-base font-bold flex items-center gap-2.5 transition-all outline-none border-b-2 cursor-pointer ${
            activeTab === "book"
              ? "border-wine-800 text-wine-900"
              : "border-transparent text-stone-400 hover:text-stone-700"
          }`}
        >
          <BadgePlus className="w-5 h-5" />
          Забронировать Урок
        </button>
      </div>

      {activeTab === "view" ? (
        /* SCREEN 1: BROWSE PRIVATE SESSIONS AND CASHIER SUMMARY */
        <div className="space-y-6">
          {/* Cashier Statistics summary drawer */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl p-5 border border-gold-100 shadow-sm">
              <p className="text-xs text-stone-400 font-mono uppercase tracking-wider">Всего Уроков</p>
              <h4 className="text-2xl font-serif font-bold text-stone-850 mt-1">{totalCount} сессий</h4>
              <p className="text-[10px] text-stone-500 mt-0.5">в архиве базы данных</p>
            </div>

            <div className="bg-emerald-50 bg-opacity-40 rounded-2xl p-5 border border-emerald-100 shadow-sm">
              <p className="text-xs text-stone-400 font-mono uppercase tracking-wider">Зачислено в Кассу</p>
              <h4 className="text-2xl font-serif font-black text-emerald-800 mt-1">{formatCur(totalPaidSum)}</h4>
              <p className="text-[10px] text-emerald-600 mt-0.5">полученные средства</p>
            </div>

            <div className="bg-rose-50 bg-opacity-40 rounded-2xl p-5 border border-rose-100 shadow-sm">
              <p className="text-xs text-stone-400 font-mono uppercase tracking-wider">Ожидаемый Баланс</p>
              <h4 className="text-2xl font-serif font-black text-rose-800 mt-1">{formatCur(totalUnpaidSum)}</h4>
              <p className="text-[10px] text-rose-600 mt-0.5">
                неоплаченные <span className="font-bold underline">{totalUnpaidCount}</span> броней
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              {/* Internal filters: All/Paid/Unpaid */}
              <div className="flex bg-stone-100 rounded-xl p-1 max-w-sm font-mono text-xs font-semibold gap-1">
                <button
                  onClick={() => setPvFilter("all")}
                  className={`px-4 py-2 rounded-lg cursor-pointer transition-all ${
                    pvFilter === "all" ? "bg-white text-stone-900 shadow-sm font-bold" : "text-stone-500 hover:text-stone-700"
                  }`}
                >
                  Все
                </button>
                <button
                  onClick={() => setPvFilter("yes")}
                  className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                    pvFilter === "yes" ? "bg-emerald-600 text-white shadow-sm font-bold" : "text-stone-500 hover:text-stone-700"
                  }`}
                >
                  Оплаченные
                </button>
                <button
                  onClick={() => setPvFilter("no")}
                  className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                    pvFilter === "no" ? "bg-rose-600 text-white shadow-sm font-bold" : "text-stone-500 hover:text-stone-700"
                  }`}
                >
                  Неоплаченные
                </button>
              </div>

              {/* Text Search Bar */}
              <div className="relative font-sans w-full md:w-72">
                <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Поиск по имени ученика..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl text-xs transition-all"
                />
              </div>
            </div>

            {/* List by Monthly folders */}
            {monthlyGroups.length === 0 ? (
              <div className="text-center py-20 text-stone-400 space-y-2">
                <span className="text-3xl font-serif">☕</span>
                <p className="text-sm font-sans">Приватные уроки с такими критериями отсутствуют.</p>
              </div>
            ) : (
              <div className="space-y-8">
                {monthlyGroups.map(group => {
                  const groupSum = group.items.reduce((s, x) => s + x.price, 0);
                  const isUnpaidInGroup = group.items.some(x => x.paid === "no");

                  return (
                    <div key={group.key} className="space-y-3 font-sans">
                      {/* Accordion look monthly head */}
                      <div className="flex items-center justify-between border-b border-stone-100 pb-2">
                        <span className="font-serif font-black text-sm text-gold-800 uppercase tracking-widest bg-gold-50 border border-gold-200/40 px-3 py-1 rounded-md">
                          {group.label}
                        </span>
                        <span className="text-xs font-mono text-stone-400 font-bold">
                          Итого за месяц: {formatCur(groupSum)}
                          {isUnpaidInGroup && (
                            <span className="text-rose-600 font-sans ml-2"> (есть долг)</span>
                          )}
                        </span>
                      </div>

                      {/* Items Cards */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {group.items.map(l => {
                          const isPaid = l.paid === "yes";

                          return (
                            <div
                              key={l.id}
                              className={`border rounded-2xl p-4 flex items-center justify-between gap-4 transition-all bg-white hover:shadow-md ${
                                isPaid ? "border-emerald-100" : "border-rose-100"
                              }`}
                            >
                              <div className="space-y-1.5 flex-1 pr-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-[9px] font-mono tracking-wider font-bold uppercase bg-stone-100 border border-stone-200 text-stone-600 px-1.5 py-0.5 rounded">
                                    {l.type === "solo" ? "Соло" : l.type === "pair" ? "Парный" : "Трио"}
                                  </span>
                                  <span className="font-mono text-xs text-stone-400">
                                    📅 {formatDateLabel(l.date)}
                                  </span>
                                </div>
                                <h4 className="font-serif font-extrabold text-stone-850 leading-tight">
                                  {renderDancersText(l)}
                                </h4>
                                <p className="font-mono text-xs font-bold text-stone-500">
                                  Стоимость: {formatCur(l.price)}
                                </p>
                              </div>

                              <div className="flex flex-col items-end gap-2.5">
                                {/* Paid / Unpaid Status and switcher link */}
                                <button
                                  onClick={() => handleTogglePaid(l)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all flex items-center gap-1 cursor-pointer select-none border ${
                                    isPaid
                                      ? "bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100"
                                      : "bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100"
                                  }`}
                                >
                                  {isPaid ? "✅ Оплачен" : "🕐 К оплате"}
                                </button>

                                <button
                                  onClick={() => handleDeleteLesson(l)}
                                  className="p-1.5 text-stone-300 hover:text-stone-600 hover:bg-stone-100 rounded-lg transition-colors cursor-pointer"
                                  title="Удалить"
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
        /* SCREEN 2: PRIVATE LESSON RESERVATION CHECKOUT FORM */
        <div className="bg-white rounded-2xl p-6 border border-gold-100 shadow-sm max-w-xl mx-auto space-y-6">
          <div className="text-center space-y-2 border-b border-stone-50 pb-5">
            <Sparkles className="w-8 h-8 text-gold-500 mx-auto" />
            <h2 className="font-serif text-xl font-bold text-stone-900">Зарезервировать Приватный Урок</h2>
            <p className="text-stone-400 text-xs font-sans">
              Оформите забронированные уроки и распределите слоты. Система поддерживает резерв оптом на несколько дат сразу.
            </p>
          </div>

          <div className="space-y-4 font-sans text-sm">
            {/* Solo, Pair, Trio custom toggles */}
            <div className="space-y-1.5">
              <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Участники репетиции</label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: "solo", emo: "🧍 Соло" },
                  { key: "pair", emo: "👫 Пара" },
                  { key: "trio", emo: "👥 Трио" }
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => {
                      setPType(item.key as "solo" | "pair" | "trio");
                      // Reset minor people suggestions if changed
                      if (item.key === "solo") { setC2Id(""); setC2Query(""); setC3Id(""); setC3Query(""); }
                      if (item.key === "pair") { setC3Id(""); setC3Query(""); }
                    }}
                    className={`py-2.5 rounded-xl border font-sans text-xs font-semibold transition-all cursor-pointer text-center ${
                      pType === item.key
                        ? "border-gold-400 bg-gold-50/50 text-gold-900 font-bold"
                        : "border-stone-200 text-stone-500 hover:border-gold-250 hover:text-stone-850"
                    }`}
                  >
                    {item.emo}
                  </button>
                ))}
              </div>
            </div>

            {/* Auto Suggests Client 1 */}
            <div className="space-y-1 relative">
              <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Главный Ученик</label>
              <input
                type="text"
                value={c1Query}
                onFocus={() => setShowC1(true)}
                onChange={(e) => {
                  setC1Query(e.target.value);
                  setC1Id("");
                  setShowC1(true);
                }}
                placeholder="Запишите фамилию для автопоиска..."
                className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl px-4 py-3 text-sm transition-all"
              />
              {showC1 && c1Suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full bg-white border border-stone-200 rounded-xl shadow-xl z-20 mt-1 overflow-hidden">
                  {c1Suggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      onClick={() => {
                        setC1Id(suggestion.id);
                        setC1Query(`${suggestion.lastName} ${suggestion.firstName}`);
                        setShowC1(false);
                      }}
                      className="cursor-pointer px-4 py-3 hover:bg-gold-50 text-stone-800 text-sm border-b border-stone-50 last:border-0 transition-colors"
                    >
                      {suggestion.lastName} {suggestion.firstName}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Auto Suggests Client 2 */}
            {(pType === "pair" || pType === "trio") && (
              <div className="space-y-1 relative">
                <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Второй ученик</label>
                <input
                  type="text"
                  value={c2Query}
                  onFocus={() => setShowC2(true)}
                  onChange={(e) => {
                    setC2Query(e.target.value);
                    setC2Id("");
                    setShowC2(true);
                  }}
                  placeholder="Запишите фамилию второго для автопоиска..."
                  className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl px-4 py-3 text-sm transition-all"
                />
                {showC2 && c2Suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full bg-white border border-stone-200 rounded-xl shadow-xl z-20 mt-1 overflow-hidden">
                    {c2Suggestions.map((suggestion) => (
                      <div
                        key={suggestion.id}
                        onClick={() => {
                          setC2Id(suggestion.id);
                          setC2Query(`${suggestion.lastName} ${suggestion.firstName}`);
                          setShowC2(false);
                        }}
                        className="cursor-pointer px-4 py-3 hover:bg-gold-50 text-stone-800 text-sm border-b border-stone-50 last:border-0 transition-colors"
                      >
                        {suggestion.lastName} {suggestion.firstName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Auto Suggests Client 3 */}
            {pType === "trio" && (
              <div className="space-y-1 relative">
                <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Третий ученик</label>
                <input
                  type="text"
                  value={c3Query}
                  onFocus={() => setShowC3(true)}
                  onChange={(e) => {
                    setC3Query(e.target.value);
                    setC3Id("");
                    setShowC3(true);
                  }}
                  placeholder="Запишите фамилию третьего для автопоиска..."
                  className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl px-4 py-3 text-sm transition-all"
                />
                {showC3 && c3Suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full bg-white border border-stone-200 rounded-xl shadow-xl z-20 mt-1 overflow-hidden">
                    {c3Suggestions.map((suggestion) => (
                      <div
                        key={suggestion.id}
                        onClick={() => {
                          setC3Id(suggestion.id);
                          setC3Query(`${suggestion.lastName} ${suggestion.firstName}`);
                          setShowC3(false);
                        }}
                        className="cursor-pointer px-4 py-3 hover:bg-gold-50 text-stone-800 text-sm border-b border-stone-50 last:border-0 transition-colors"
                      >
                        {suggestion.lastName} {suggestion.firstName}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="border-t border-stone-100 my-4 pt-4" />

            {/* Multi dates fields control section */}
            <div className="space-y-2">
              <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Даты бронирования</label>
              <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                {dates.map((dateStr, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <input
                      type="date"
                      required
                      value={dateStr}
                      onChange={(e) => handleDateChange(idx, e.target.value)}
                      className="flex-1 bg-stone-50 border border-stone-200 focus:border-gold-400 outline-none rounded-xl px-4 py-2 text-sm transition-all font-mono"
                    />
                    <button
                      type="button"
                      disabled={dates.length <= 1}
                      onClick={() => handleRemoveDate(idx)}
                      className={`p-2.5 rounded-xl border text-stone-400 hover:text-stone-700 hover:bg-stone-50 transition-colors cursor-pointer ${
                        dates.length <= 1 ? "opacity-30 cursor-not-allowed" : ""
                      }`}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={handleAddDate}
                className="w-full py-2 bg-stone-50 border border-dashed border-stone-300 rounded-xl text-stone-600 hover:bg-stone-100 transition-all font-mono text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                ＋ Добавить дату бронирования
              </button>
            </div>

            <div className="border-t border-stone-100 my-4 pt-4" />

            {/* Prices configuration and autofill */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-stone-400 font-mono uppercase tracking-wider">Стоимость за 1 урок</label>
                <button
                  type="button"
                  onClick={pullStandardPrice}
                  className="text-xs text-gold-600 hover:underline font-mono font-semibold uppercase cursor-pointer"
                >
                  Взять из прайса
                </button>
              </div>

              <div className="relative font-mono">
                <input
                  type="number"
                  placeholder="0"
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className="w-full bg-stone-50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl pl-4 pr-12 py-3 text-sm transition-all font-bold"
                />
                <span className="absolute right-4 top-3 text-stone-400 text-sm font-sans font-medium pointer-events-none">₫</span>
              </div>
            </div>

            <div className="border-t border-stone-100 my-4 pt-4" />

            {/* Submitting buttons checkout triggers */}
            <div className="grid grid-cols-2 gap-3.5">
              <button
                onClick={() => handleBook(true)}
                className="py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-bold tracking-widest uppercase rounded-xl transition-all shadow-md shadow-emerald-500/10 cursor-pointer"
              >
                ✅ Оплачено (Бронь)
              </button>

              <button
                onClick={() => handleBook(false)}
                className="py-4 bg-stone-100 hover:bg-stone-200 text-stone-750 font-mono text-xs font-bold tracking-widest uppercase rounded-xl transition-all cursor-pointer"
              >
                🕐 Без оплаты (Бронь)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
