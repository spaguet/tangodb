/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Ticket, FileCheck, Search, Send } from "lucide-react";
import { useClients } from "../hooks/useClients";
import { usePrices } from "../hooks/usePrices";
import {
  useAddSubscription,
  useFinishSubscription,
  useSubscriptions,
} from "../hooks/useSubscriptions";
import { formatCurrency } from "../lib/utils";
import { useUIStore } from "../store/ui";
import type { Client, Price } from "../types";

interface SubscriptionsPanelProps {
  initialTab?: "active" | "sell";
  toast: (msg: string) => void;
}

export default function SubscriptionsPanel({
  initialTab = "active",
  toast,
}: SubscriptionsPanelProps) {
  const navigate = useNavigate();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);

  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const { data: subscriptions = [], isLoading: subsLoading } = useSubscriptions();
  const { data: prices = [], isLoading: pricesLoading } = usePrices();
  const addSubscription = useAddSubscription();
  const finishSubscription = useFinishSubscription();

  const isLoading = clientsLoading || subsLoading || pricesLoading;
  const [activeTab, setActiveTab] = useState<"sell" | "active">(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const switchTab = (tab: "active" | "sell") => {
    setActiveTab(tab);
    setSubscriptionsTab(tab);
    navigate(tab === "sell" ? "/subscriptions/sell" : "/subscriptions");
  };

  const [search, setSearch] = useState("");

  // Sale form states
  const [subType, setSubType] = useState<"solo" | "pair">("solo");
  const [lessonsCount, setLessonsCount] = useState<4 | 8>(8);
  const [pairMonth, setPairMonth] = useState<1 | 2 | 3>(1);

  // Client Autocomplete states
  const [client1Query, setClient1Query] = useState("");
  const [client1Id, setClient1Id] = useState("");
  const [client1Suggestions, setClient1Suggestions] = useState<Client[]>([]);
  const [showC1List, setShowC1List] = useState(false);

  const [client2Query, setClient2Query] = useState("");
  const [client2Id, setClient2Id] = useState("");
  const [client2Suggestions, setClient2Suggestions] = useState<Client[]>([]);
  const [showC2List, setShowC2List] = useState(false);

  // Date activation - defaults to today
  const [activationDate, setActivationDate] = useState("");

  useEffect(() => {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setActivationDate(`${today.getFullYear()}-${mm}-${dd}`);
  }, []);

  // Update suggestions based on user input for Client 1
  useEffect(() => {
    if (client1Query.trim() === "") {
      setClient1Suggestions([]);
      return;
    }
    const filtered = clients.filter(
      (c) =>
        c.firstName.toLowerCase().includes(client1Query.toLowerCase()) ||
        c.lastName.toLowerCase().includes(client1Query.toLowerCase())
    );
    setClient1Suggestions(filtered.slice(0, 5));
  }, [client1Query, clients]);

  // Update suggestions based on user input for Client 2
  useEffect(() => {
    if (client2Query.trim() === "") {
      setClient2Suggestions([]);
      return;
    }
    const filtered = clients.filter(
      (c) =>
        c.firstName.toLowerCase().includes(client2Query.toLowerCase()) ||
        c.lastName.toLowerCase().includes(client2Query.toLowerCase())
    );
    setClient2Suggestions(filtered.slice(0, 5));
  }, [client2Query, clients]);

  // Pricing engine
  const getSubPrice = (): number => {
    let matched: Price | undefined;
    if (subType === "solo") {
      matched = prices.find((p) => p.type.trim() === "solo" && p.lessons === lessonsCount);
    } else {
      if (lessonsCount === 4) {
        matched = prices.find((p) => p.type.trim() === "pair_hm");
      } else {
        matched = prices.find((p) => p.type.trim() === `pair_m${pairMonth}`);
      }
    }
    return matched ? matched.price : 0;
  };

  const handleCheckout = async () => {
    if (!client1Query || !client1Id) {
      toast("⚠️ Выберите главного клиента из поискового списка.");
      return;
    }

    if (subType === "pair" && (!client2Query || !client2Id)) {
      toast("⚠️ Выберите второго парного клиента из списка.");
      return;
    }

    if (subType === "pair" && client1Id === client2Id) {
      toast("⚠️ Оба клиента совпадают. Выберите разных гостей.");
      return;
    }

    if (!activationDate) {
      toast("⚠️ Укажите дату активации абонемента.");
      return;
    }

    const payload = {
      type: subType === "solo" ? "solo" : lessonsCount === 4 ? "pair_hm" : "pair",
      clientId1: client1Id,
      clientId2: subType === "pair" ? client2Id : "",
      lessonsTotal: lessonsCount,
      activationDate,
      pairMonth: subType === "pair" && lessonsCount === 8 ? String(pairMonth) : "",
    };

    toast("⏳ Продажа...");
    const res = await addSubscription.mutateAsync(payload);
    if (!res.success) {
      toast(`⚠️ Ошибка: ${res.error || "абонемент не оформлен"}`);
    } else {
      toast("✅ Абонемент успешно продан и активирован!");
      // Reset form fields
      setClient1Query("");
      setClient1Id("");
      setClient2Query("");
      setClient2Id("");
      setSubType("solo");
      setLessonsCount(8);
      setPairMonth(1);
    }
  };

  const handleFinishSub = async (subId: string, clientName: string) => {
    const check = window.confirm(`Вы уверены, что хотите досрочно завершить абонемент ${clientName}?`);
    if (!check) return;

    toast("⏳ Завершение...");
    const res = await finishSubscription.mutateAsync(subId);
    if (!res.success) {
      toast(`⚠️ Ошибка: ${res.error || "Не удалось завершить абонемент"}`);
    } else {
      toast("✅ Абонемент закрыт со статусом 'finished'");
    }
  };

  // Directory filter for active records
  const activeRecords = subscriptions
    .filter((s) => s.status === "active")
    .sort((a, b) => a.lessonsLeft - b.lessonsLeft); // show struggling/almost complete ones first

  const clientMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {} as Record<string, Client>);

  const filteredActiveRecords = activeRecords.filter((sub) => {
    const c1 = clientMap[sub.clientId1];
    const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;

    const queryStr = `${c1?.firstName || ""} ${c1?.lastName || ""} ${c2?.firstName || ""} ${c2?.lastName || ""}`.toLowerCase();
    return queryStr.includes(search.toLowerCase());
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-stone-400 text-sm font-sans">
        Загрузка абонементов...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Visual toggle header */}
      <div className="flex border-b border-stone-200">
        <button
          onClick={() => switchTab("active")}
          className={`px-6 py-4.5 font-serif text-base font-bold flex items-center gap-2.5 transition-all outline-none border-b-2 cursor-pointer ${
            activeTab === "active"
              ? "border-wine-800 text-wine-900"
              : "border-transparent text-stone-400 hover:text-stone-700"
          }`}
        >
          <FileCheck className="w-5 h-5" />
          Действующие абонементы
          <span className="bg-stone-50 text-stone-500 font-mono text-xs px-2 py-0.5 rounded-full border border-stone-100">
            {activeRecords.length}
          </span>
        </button>
        <button
          onClick={() => switchTab("sell")}
          className={`px-6 py-4.5 font-serif text-base font-bold flex items-center gap-2.5 transition-all outline-none border-b-2 cursor-pointer ${
            activeTab === "sell"
              ? "border-wine-800 text-wine-900"
              : "border-transparent text-stone-400 hover:text-stone-700"
          }`}
        >
          <Ticket className="w-5 h-5" />
          Продажа (Оформление)
        </button>
      </div>

      {activeTab === "active" ? (
        /* PANEL 1: VIEW ACTIVE MEMBERSHIPS */
        <div className="bg-white rounded-2xl p-6 border border-gold-100 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-serif text-xl font-bold text-stone-800">Действующие абонементы</h2>
              <p className="text-xs text-stone-400 font-sans mt-1">
                Список студентов с активными пакетами занятий, отсортированный по остатку занятий (меньше всего вверху)
              </p>
            </div>

            {/* Subscriptions search bar */}
            <div className="relative font-sans w-full sm:w-72">
              <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-3.5 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по фамилии гостя..."
                className="w-full pl-10 pr-4 py-2.5 bg-stone-50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl text-xs transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredActiveRecords.length === 0 ? (
              <div className="col-span-2 text-center py-20 text-stone-400 space-y-2">
                <p className="text-stone-300 font-serif italic text-3xl">🎫</p>
                <p className="text-sm font-sans">Поиск не дал результатов или активные абонементы отсутствуют в базе.</p>
              </div>
            ) : (
              filteredActiveRecords.map((sub) => {
                const c1 = clientMap[sub.clientId1];
                const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;

                const clientNameStr = c2
                  ? `${c1?.lastName || ""} ${c1?.firstName || ""} & ${c2?.lastName || ""} ${c2?.firstName || ""}`
                  : `${c1?.lastName || ""} ${c1?.firstName || ""}`;

                // Progress calculated
                const progressPct = sub.lessonsTotal > 0 ? (sub.lessonsLeft / sub.lessonsTotal) * 100 : 0;
                const isAlarm = sub.lessonsLeft <= 2;

                return (
                  <div
                    key={sub.id}
                    className="border border-stone-100/80 rounded-2xl p-5 bg-stone-50/50 hover:bg-white hover:border-gold-200 hover:shadow-md transition-all flex flex-col justify-between gap-6"
                  >
                    <div className="space-y-3.5">
                      <div className="flex items-center justify-between">
                        {/* Membership Type Name Badge */}
                        <span className="text-[10px] font-mono font-bold tracking-wider uppercase px-2.5 py-1 rounded-md bg-gold-100 text-gold-900 border border-gold-200/40">
                          {sub.type === "solo"
                            ? "Соло"
                            : sub.type === "pair_hm"
                            ? "Пара (Полмесяца)"
                            : `Пара · ${sub.pairMonth}-й месяц`}
                        </span>

                        {/* Freeze Badge */}
                        {sub.lessonsTotal === 8 ? (
                          sub.freezeUsed > 0 ? (
                            <span className="text-[10px] font-mono text-stone-400 bg-stone-100/50 px-2 py-0.5 rounded border border-stone-200/50">
                              ❄️ Х заморозка использована
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                              ❄️ заморозка доступна
                            </span>
                          )
                        ) : null}
                      </div>

                      {/* Client Name Details */}
                      <div>
                        <h3 className="font-serif text-base font-bold text-stone-850 leading-tight">
                          {clientNameStr}
                        </h3>
                        <p className="text-xs text-stone-400 mt-1 font-mono">
                          Активирован: {sub.activationDate || "—"}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        {c1?.telegram && (
                          <a
                            href={c1.telegram}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-[#229ED9] bg-[#229ED9]/5 px-2 py-0.5 rounded"
                          >
                            <Send className="w-3 h-3" />
                            {c1.firstName}
                          </a>
                        )}
                        {c2?.telegram && (
                          <a
                            href={c2.telegram}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-mono text-[#229ED9] bg-[#229ED9]/5 px-2 py-0.5 rounded"
                          >
                            <Send className="w-3 h-3" />
                            {c2.firstName}
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Progress Class bar */}
                    <div className="space-y-2 border-t border-stone-100/30 pt-4">
                      <div className="flex items-center justify-between text-xs font-sans">
                        <span className="text-stone-400">Пройдено занятий</span>
                        <span className="font-mono font-bold text-stone-800">
                          {sub.lessonsLeft} <span className="text-stone-400 font-normal">из {sub.lessonsTotal}</span>
                        </span>
                      </div>
                      <div className="w-full bg-stone-100 h-2.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isAlarm ? "bg-rose-500" : "bg-gold-400"
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between pt-3 text-xs font-mono">
                        {isAlarm ? (
                          <span className="text-red-500 font-sans font-medium">⚠️ Срочное продление!</span>
                        ) : (
                          <span className="text-stone-400 font-sans font-medium">✨ Стабильный пакет</span>
                        )}

                        <button
                          onClick={() => handleFinishSub(sub.id, clientNameStr)}
                          className="text-stone-400 hover:text-stone-700 hover:underline cursor-pointer transition-all uppercase text-[10px]"
                        >
                          Завершить
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* PANEL 2: SELL AND CHECKOUT NEW TICKET */
        <div className="bg-white rounded-2xl p-6 border border-gold-100 shadow-sm max-w-xl mx-auto space-y-6">
          <div className="text-center space-y-2 border-b border-stone-50 pb-5">
            <Ticket className="w-8 h-8 text-gold-500 mx-auto" />
            <h2 className="font-serif text-xl font-bold text-stone-900">Продажа Абонемента</h2>
            <p className="text-stone-400 text-xs font-sans">
              Оформите новый групповой абонемент для клиента, оплата и запись отправятся в Google-базу.
            </p>
          </div>

          <div className="space-y-4 font-sans text-sm">
            {/* Solo vs Pair selective */}
            <div className="space-y-1.5">
              <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Тип Абонемента</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSubType("solo");
                    setClient2Id("");
                    setClient2Query("");
                  }}
                  className={`py-3 rounded-xl border font-sans text-sm font-semibold transition-all cursor-pointer text-center ${
                    subType === "solo"
                      ? "border-gold-400 bg-gold-50/50 text-gold-900 font-bold"
                      : "border-stone-200 text-stone-500 hover:border-gold-200 hover:text-stone-850"
                  }`}
                >
                  🧍 Соло (Для одного)
                </button>
                <button
                  type="button"
                  onClick={() => setSubType("pair")}
                  className={`py-3 rounded-xl border font-sans text-sm font-semibold transition-all cursor-pointer text-center ${
                    subType === "pair"
                      ? "border-gold-400 bg-gold-50/50 text-gold-900 font-bold"
                      : "border-stone-200 text-stone-500 hover:border-gold-200 hover:text-stone-850"
                  }`}
                >
                  👫 Парный (Для пары)
                </button>
              </div>
            </div>

            {/* Client Autocomplete Selection */}
            <div className="space-y-1 relative">
              <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">
                {subType === "pair" ? "Первый участник (Гость)" : "Ученик (Гость)"}
              </label>
              <input
                type="text"
                value={client1Query}
                onFocus={() => setShowC1List(true)}
                onChange={(e) => {
                  setClient1Query(e.target.value);
                  setClient1Id("");
                  setShowC1List(true);
                }}
                placeholder="Введите фамилию ученика для поиска..."
                className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl px-4 py-3 text-sm transition-all"
              />
              {showC1List && client1Suggestions.length > 0 && (
                <div className="absolute left-0 right-0 top-full bg-white border border-stone-200 rounded-xl shadow-xl z-15 mt-1 overflow-hidden">
                  {client1Suggestions.map((suggestion) => (
                    <div
                      key={suggestion.id}
                      onClick={() => {
                        setClient1Id(suggestion.id);
                        setClient1Query(`${suggestion.lastName} ${suggestion.firstName}`);
                        setShowC1List(false);
                      }}
                      className="cursor-pointer px-4 py-3 hover:bg-gold-50 text-stone-800 text-sm border-b border-stone-50 last:border-0 transition-colors"
                    >
                      {suggestion.lastName} {suggestion.firstName}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Client 2 (couple) autocomplete */}
            {subType === "pair" && (
              <div className="space-y-1 relative animate-fade-in">
                <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Второй участник</label>
                <input
                  type="text"
                  value={client2Query}
                  onFocus={() => setShowC2List(true)}
                  onChange={(e) => {
                    setClient2Query(e.target.value);
                    setClient2Id("");
                    setShowC2List(true);
                  }}
                  placeholder="Введите фамилию партнёра для поиска..."
                  className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl px-4 py-3 text-sm transition-all"
                />
                {showC2List && client2Suggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full bg-white border border-stone-200 rounded-xl shadow-xl z-15 mt-1 overflow-hidden">
                    {client2Suggestions.map((suggestion) => (
                      <div
                        key={suggestion.id}
                        onClick={() => {
                          setClient2Id(suggestion.id);
                          setClient2Query(`${suggestion.lastName} ${suggestion.firstName}`);
                          setShowC2List(false);
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

            {/* Tickets sizes (4 or 8 lessons) */}
            <div className="space-y-1.5">
              <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Пакет занятий</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setLessonsCount(4)}
                  className={`py-2.5 rounded-xl border font-sans text-xs font-semibold transition-all cursor-pointer text-center ${
                    lessonsCount === 4
                      ? "border-gold-400 bg-gold-50/50 text-gold-900 font-bold"
                      : "border-stone-200 text-stone-500 hover:border-gold-200 hover:text-stone-850"
                  }`}
                >
                  🎟 4 урока (Срок: Полмесяца)
                </button>
                <button
                  type="button"
                  onClick={() => setLessonsCount(8)}
                  className={`py-2.5 rounded-xl border font-sans text-xs font-semibold transition-all cursor-pointer text-center ${
                    lessonsCount === 8
                      ? "border-gold-400 bg-gold-50/50 text-gold-900 font-bold"
                      : "border-stone-200 text-stone-500 hover:border-gold-200 hover:text-stone-850"
                  }`}
                >
                  🎫 8 уроков (Срок: Один месяц)
                </button>
              </div>
            </div>

            {/* Couple months tracking (only on subType couple & 8 classes) */}
            {subType === "pair" && lessonsCount === 8 && (
              <div className="space-y-1.5 animate-fade-in">
                <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">
                  Номер месяца парного обучения (Для расчета тарификации)
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {[1, 2, 3].map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPairMonth(m as 1 | 2 | 3)}
                      className={`py-2.5 rounded-xl border font-sans text-xs font-semibold transition-all cursor-pointer text-center ${
                        pairMonth === m
                          ? "border-gold-400 bg-gold-50/50 text-gold-900 font-bold"
                          : "border-stone-200 text-stone-500 hover:border-gold-250 hover:text-stone-850"
                      }`}
                    >
                      {m}-й месяц
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Activation Dates */}
            <div className="space-y-1">
              <label className="text-xs text-stone-400 font-mono uppercase tracking-wider block">Дата Активации</label>
              <input
                type="date"
                required
                value={activationDate}
                onChange={(e) => setActivationDate(e.target.value)}
                className="w-full bg-stone-50/50 border border-stone-200 focus:border-gold-400 focus:bg-white outline-none rounded-xl px-4 py-3 text-sm transition-all"
              />
            </div>

            <div className="border-t border-stone-100 my-4 pt-4" />

            {/* Checkout Pricing overview block */}
            <div className="flex items-center justify-between p-4 bg-gold-100/30 rounded-2xl border border-gold-200/40">
              <span className="text-stone-600 font-serif font-semibold text-sm">Финальная стоимость</span>
              <span className="text-xl font-serif font-black text-gold-800">
                {getSubPrice() > 0 ? formatCurrency(getSubPrice()) : "не настроена"}
              </span>
            </div>

            {/* Submission Checkout Trigger */}
            <button
              onClick={handleCheckout}
              className="w-full py-4 bg-wine-800 hover:bg-wine-900 text-gold-100 font-mono text-xs font-bold tracking-widest uppercase rounded-xl transition-all shadow-md shadow-wine-950/10 cursor-pointer"
            >
              Продать Абонемент
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
