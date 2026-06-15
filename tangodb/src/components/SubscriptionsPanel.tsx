/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Ticket, FileCheck, Search, Send, Snowflake } from "lucide-react";
import { normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { useClients } from "../hooks/useClients";
import { useDisciplines } from "../hooks/useDisciplines";
import { usePrices } from "../hooks/usePrices";
import {
  useAddSubscription,
  useFinishSubscription,
  useSubscriptions,
} from "../hooks/useSubscriptions";
import { formatCurrency, deriveSubscriptionTypeFromTariff, getGroupTariffs, getPriceLabel, getSubscriptionTariffLabel, tariffNeedsSecondClient } from "../lib/utils";
import { useUIStore } from "../store/ui";
import ClientAutocomplete from "./ui/ClientAutocomplete";
import AppSelect from "./ui/AppSelect";
import ConfirmDialog from "./ui/ConfirmDialog";
import DisciplineSelect from "./ui/DisciplineSelect";
import LoadingState from "./ui/LoadingState";
import QueryErrorState from "./ui/QueryErrorState";
import PageTabs, { pageTabPanelCls } from "./ui/PageTabs";
import type { ToastType } from "../App";
import type { Client } from "../types";

interface SubscriptionsPanelProps {
  initialTab?: "active" | "sell";
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function SubscriptionsPanel({
  initialTab = "active",
  toast,
}: SubscriptionsPanelProps) {
  const navigate = useNavigate();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);

  const clientsQuery = useClients();
  const disciplinesQuery = useDisciplines();
  const subscriptionsQuery = useSubscriptions();
  const pricesQuery = usePrices();
  const { data: clients = [], isLoading: clientsLoading, isError: clientsError, error: clientsErr } = clientsQuery;
  const { data: disciplines = [], isLoading: disciplinesLoading, isError: disciplinesError, error: disciplinesErr } = disciplinesQuery;
  const { data: subscriptions = [], isLoading: subsLoading, isError: subsError, error: subsErr } = subscriptionsQuery;
  const { data: prices = [], isLoading: pricesLoading, isError: pricesError, error: pricesErr } = pricesQuery;
  const addSubscription = useAddSubscription();
  const finishSubscription = useFinishSubscription();

  const isLoading = clientsLoading || disciplinesLoading || subsLoading || pricesLoading;
  const isError = clientsError || disciplinesError || subsError || pricesError;
  const error = clientsErr ?? disciplinesErr ?? subsErr ?? pricesErr;
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
  const groupTariffs = getGroupTariffs(prices);
  const [selectedTariffId, setSelectedTariffId] = useState<number | "">("");

  const [client1Query, setClient1Query] = useState("");
  const [client1Id, setClient1Id] = useState("");
  const [client2Query, setClient2Query] = useState("");
  const [client2Id, setClient2Id] = useState("");
  const [disciplineId, setDisciplineId] = useState<number | "">("");

  useEffect(() => {
    if (disciplines.length > 0 && disciplineId === "") {
      setDisciplineId(disciplines[0].id);
    }
  }, [disciplines, disciplineId]);

  // Early-finish confirmation target
  const [finishTarget, setFinishTarget] = useState<{ id: string; name: string } | null>(null);

  // Date activation - defaults to today
  const [activationDate, setActivationDate] = useState("");

  useEffect(() => {
    if (groupTariffs.length > 0 && selectedTariffId === "") {
      const defaultTariff =
        groupTariffs.find((p) => p.id && p.type.trim() === "solo" && p.lessons === 8) ?? groupTariffs[0];
      if (defaultTariff?.id) setSelectedTariffId(defaultTariff.id);
    }
  }, [groupTariffs, selectedTariffId]);

  const selectedTariff = groupTariffs.find((p) => p.id === selectedTariffId);
  const needsSecondClient = selectedTariff ? tariffNeedsSecondClient(selectedTariff) : false;

  useEffect(() => {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    setActivationDate(`${today.getFullYear()}-${mm}-${dd}`);
  }, []);

  const getSubPrice = (): number => selectedTariff?.price ?? 0;

  const handleCheckout = async () => {
    if (!selectedTariff?.id) {
      toast("Выберите тариф из прайс-листа.", "error");
      return;
    }

    if (!client1Query || !client1Id) {
      toast("Выберите клиента из поискового списка.", "error");
      return;
    }

    if (needsSecondClient && (!client2Query || !client2Id)) {
      toast("Выберите второго клиента пары из списка.", "error");
      return;
    }

    if (needsSecondClient && client1Id === client2Id) {
      toast("Оба клиента совпадают. Выберите разных клиентов.", "error");
      return;
    }

    if (!disciplineId) {
      toast("Выберите дисциплину.", "error");
      return;
    }

    if (!activationDate) {
      toast("Укажите дату активации абонемента.", "error");
      return;
    }

    const { type, pairMonth } = deriveSubscriptionTypeFromTariff(selectedTariff);

    const payload = {
      type,
      clientId1: client1Id,
      clientId2: needsSecondClient ? client2Id : "",
      lessonsTotal: selectedTariff.lessons,
      activationDate,
      pairMonth,
      disciplineId: disciplineId as number,
      priceId: selectedTariff.id,
      category: "group" as const,
    };

    const res = await addSubscription.mutateAsync(payload);
    if (!res.success) {
      toast(res.error || "Абонемент не оформлен", "error");
    } else {
      toast("Абонемент продан и активирован", "success");
      setClient1Query("");
      setClient1Id("");
      setClient2Query("");
      setClient2Id("");
    }
  };

  const handleConfirmFinish = async () => {
    if (!finishTarget) return;
    const res = await finishSubscription.mutateAsync(finishTarget.id);
    if (!res.success) {
      toast(res.error || "Не удалось завершить абонемент", "error");
    } else {
      toast("Абонемент завершён", "success");
      setFinishTarget(null);
    }
  };

  // Directory filter for active records (lowest balance first)
  const activeRecords = subscriptions
    .filter((s) => s.status === "active")
    .sort((a, b) => a.lessonsLeft - b.lessonsLeft);

  const clientMap = clients.reduce((acc, c) => ({ ...acc, [c.id]: c }), {} as Record<string, Client>);
  const disciplineMap = disciplines.reduce(
    (acc, d) => ({ ...acc, [d.id]: d }),
    {} as Record<number, (typeof disciplines)[0]>
  );

  const filteredActiveRecords = activeRecords.filter((sub) => {
    const c1 = clientMap[sub.clientId1];
    const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
    const c3 = sub.clientId3 ? clientMap[sub.clientId3] : null;

    const queryStr = `${c1?.firstName || ""} ${c1?.lastName || ""} ${c2?.firstName || ""} ${c2?.lastName || ""} ${c3?.firstName || ""} ${c3?.lastName || ""}`.toLowerCase();
    return queryStr.includes(search.toLowerCase());
  });

  if (isLoading) return <LoadingState label="Загрузка абонементов..." />;
  if (isError) return <QueryErrorState error={error} />;

  const subscriptionTabs = [
    { id: "active", label: "Просмотр", icon: FileCheck },
    { id: "sell", label: "Продажа", icon: Ticket },
  ] as const;

  return (
    <div>
      <PageTabs tabs={[...subscriptionTabs]} activeTab={activeTab} onChange={switchTab} />

      {activeTab === "active" ? (
        /* PANEL 1: VIEW ACTIVE MEMBERSHIPS */
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack ${pageTabPanelCls(activeTab, "active")}`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-slate-800">Действующие абонементы</h2>
              <p className="text-xs text-slate-400 mt-1">
                Отсортированы по остатку занятий — требующие продления вверху
              </p>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по фамилии клиента..."
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg text-xs transition-all"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filteredActiveRecords.length === 0 ? (
              <div className="col-span-2 text-center py-20 text-slate-400 space-y-3">
                <Ticket className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm">
                  {search.trim()
                    ? "Поиск не дал результатов."
                    : "Активных абонементов пока нет."}
                </p>
                {!search.trim() && (
                  <button
                    onClick={() => switchTab("sell")}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    Продать первый абонемент →
                  </button>
                )}
              </div>
            ) : (
              filteredActiveRecords.map((sub) => {
                const c1 = clientMap[sub.clientId1];
                const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
                const c3 = sub.clientId3 ? clientMap[sub.clientId3] : null;

                const clientNameStr = [c1, c2, c3]
                  .filter(Boolean)
                  .map((c) => `${c!.lastName || ""} ${c!.firstName || ""}`.trim())
                  .join(" & ");

                const progressPct = sub.lessonsTotal > 0 ? (sub.lessonsLeft / sub.lessonsTotal) * 100 : 0;
                const isAlarm = sub.lessonsLeft <= 2;

                const disciplineName =
                  sub.disciplineId != null ? disciplineMap[sub.disciplineId]?.name : undefined;

                const tariffLabel = getSubscriptionTariffLabel(sub, prices);

                return (
                  <div
                    key={sub.id}
                    className="border border-slate-200 rounded-xl p-5 bg-white hover:border-indigo-200 hover:shadow-sm transition-all flex flex-col justify-between gap-5"
                  >
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <p className="text-[11px] font-sans font-semibold text-indigo-700 leading-snug">
                          {tariffLabel}
                        </p>
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          {sub.category === "private" ? (
                            <span className="text-[10px] font-sans font-semibold tracking-wider uppercase text-violet-600 bg-violet-50 px-2 py-0.5 rounded border border-violet-100">
                              персональный
                            </span>
                          ) : disciplineName ? (
                            <span className="text-[10px] font-sans font-semibold tracking-wider uppercase text-slate-500">
                              {disciplineName}
                            </span>
                          ) : (
                            <span />
                          )}

                          {sub.lessonsTotal === 8 ? (
                            sub.freezeUsed > 0 ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-sans text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                <Snowflake className="w-3 h-3" /> заморозка использована
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-sans text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                                <Snowflake className="w-3 h-3" /> заморозка доступна
                              </span>
                            )
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-semibold text-slate-800 leading-tight">{clientNameStr}</h3>
                        <p className="text-[11px] text-slate-400 mt-1 font-sans">
                          Активирован: {sub.activationDate || "—"}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        {c1?.telegram && normalizeTelegramContact(c1.telegram) && (
                          <a
                            href={normalizeTelegramContact(c1.telegram)!}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              e.preventDefault();
                              openTelegramContact(c1.telegram);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-sans text-[#1C82B4] bg-[#229ED9]/10 hover:bg-[#229ED9]/20 px-2 py-0.5 rounded transition-colors"
                          >
                            <Send className="w-3 h-3" />
                            {c1.firstName}
                          </a>
                        )}
                        {c2?.telegram && normalizeTelegramContact(c2.telegram) && (
                          <a
                            href={normalizeTelegramContact(c2.telegram)!}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              e.preventDefault();
                              openTelegramContact(c2.telegram);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-sans text-[#1C82B4] bg-[#229ED9]/10 hover:bg-[#229ED9]/20 px-2 py-0.5 rounded transition-colors"
                          >
                            <Send className="w-3 h-3" />
                            {c2.firstName}
                          </a>
                        )}
                        {c3?.telegram && normalizeTelegramContact(c3.telegram) && (
                          <a
                            href={normalizeTelegramContact(c3.telegram)!}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => {
                              e.preventDefault();
                              openTelegramContact(c3.telegram);
                            }}
                            className="inline-flex items-center gap-1 text-[11px] font-sans text-[#1C82B4] bg-[#229ED9]/10 hover:bg-[#229ED9]/20 px-2 py-0.5 rounded transition-colors"
                          >
                            <Send className="w-3 h-3" />
                            {c3.firstName}
                          </a>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2 border-t border-slate-100 pt-4">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Осталось занятий</span>
                        <span className="font-sans font-semibold text-slate-800">
                          {sub.lessonsLeft} <span className="text-slate-400 font-normal">из {sub.lessonsTotal}</span>
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            isAlarm ? "bg-rose-500" : "bg-indigo-500"
                          }`}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>

                      <div className="flex items-center justify-between pt-2 text-xs">
                        {isAlarm ? (
                          <span className="text-rose-600 font-semibold">Пора предложить продление</span>
                        ) : (
                          <span className="text-slate-400">Баланс в норме</span>
                        )}

                        <button
                          onClick={() => setFinishTarget({ id: sub.id, name: clientNameStr })}
                          className="text-slate-400 hover:text-rose-600 hover:underline cursor-pointer transition-colors uppercase text-[10px] font-sans font-semibold"
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
        /* PANEL 2: SELL NEW SUBSCRIPTION */
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs max-w-xl mx-auto panel-card-stack ${pageTabPanelCls(activeTab, "active")}`}
        >
          <div className="panel-form-header">
            <div className="panel-form-header-icon">
              <Ticket className="w-5 h-5 text-indigo-600" />
            </div>
            <h2 className="text-base font-semibold tracking-tight text-slate-900">Продажа абонемента</h2>
            <p className="text-slate-400 text-[11px] leading-snug">
              Оформите новый групповой абонемент — запись сразу попадёт в базу.
            </p>
          </div>

          <div className="panel-form-stack">
            <div className="field-stack">
              <label className={labelCls}>ТАРИФ АБОНЕМЕНТА</label>
              {groupTariffs.length === 0 ? (
                <p className="text-xs text-slate-400 font-sans">Нет групповых тарифов в прайс-листе.</p>
              ) : (
                <AppSelect
                  value={selectedTariffId}
                  onChange={(e) => {
                    const id = parseInt(e.target.value, 10);
                    if (Number.isNaN(id)) return;
                    setSelectedTariffId(id);
                    const tariff = groupTariffs.find((p) => p.id === id);
                    if (tariff && !tariffNeedsSecondClient(tariff)) {
                      setClient2Id("");
                      setClient2Query("");
                    }
                  }}
                >
                  {groupTariffs.map((tariff) => (
                    <option key={tariff.id} value={tariff.id!}>
                      {getPriceLabel(tariff)} — {tariff.lessons} занятий · {formatCurrency(tariff.price)}
                    </option>
                  ))}
                </AppSelect>
              )}
            </div>

            <DisciplineSelect
              disciplines={disciplines}
              value={disciplineId}
              onChange={setDisciplineId}
              toast={toast}
            />

            <ClientAutocomplete
              label={needsSecondClient ? "Первый клиент" : "Клиент"}
              clients={clients}
              query={client1Query}
              selectedId={client1Id}
              showAddClientButton
              addClientLinkLabel="Новый клиент"
              toast={toast}
              onQueryChange={(q) => {
                setClient1Query(q);
                setClient1Id("");
              }}
              onSelect={(c) => {
                setClient1Id(c.id);
                setClient1Query(`${c.lastName} ${c.firstName}`);
              }}
            />

            {needsSecondClient && (
              <div className="animate-fade-in">
                <ClientAutocomplete
                  label="Второй клиент"
                  clients={clients}
                  query={client2Query}
                  selectedId={client2Id}
                  showAddClientButton
                  addClientLinkLabel="Новый клиент"
                  toast={toast}
                  onQueryChange={(q) => {
                    setClient2Query(q);
                    setClient2Id("");
                  }}
                  onSelect={(c) => {
                    setClient2Id(c.id);
                    setClient2Query(`${c.lastName} ${c.firstName}`);
                  }}
                />
              </div>
            )}

            <div className="border-t border-slate-100 pt-1.5 -mt-1" />

            <div className="field-stack">
              <label className={labelCls}>Дата активации</label>
              <input
                type="date"
                required
                value={activationDate}
                onChange={(e) => setActivationDate(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg px-3.5 py-2.5 text-sm transition-all"
              />
            </div>

            <div className="panel-form-divider" />

            <div className="flex items-center justify-between p-3 bg-indigo-50/60 rounded-xl border border-indigo-100">
              <span className="text-slate-600 font-semibold text-sm">Итого к оплате</span>
              <span className="text-xl font-sans font-semibold text-indigo-700">
                {getSubPrice() > 0 ? formatCurrency(getSubPrice()) : "тариф не настроен"}
              </span>
            </div>
            <p className="text-slate-400 text-xs font-sans text-center -mt-1">
              Для изменения стоимости абонемента перейдите в раздел{" "}
              <button
                type="button"
                onClick={() => navigate("/prices")}
                className="text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer font-semibold"
              >
                Прайс-лист
              </button>
            </p>

            <div className="panel-form-divider" />

            <button
              onClick={handleCheckout}
              disabled={addSubscription.isPending}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60"
            >
              {addSubscription.isPending ? "Оформление..." : "Продать абонемент"}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={finishTarget !== null}
        title="Завершить абонемент досрочно?"
        description={
          <>
            Абонемент <strong className="font-semibold text-slate-800">{finishTarget?.name}</strong> будет закрыт со
            статусом «завершён». Оставшиеся занятия сгорят.
          </>
        }
        confirmLabel="Завершить"
        pending={finishSubscription.isPending}
        onConfirm={handleConfirmFinish}
        onCancel={() => setFinishTarget(null)}
      />
    </div>
  );
}
