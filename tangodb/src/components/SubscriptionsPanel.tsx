/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Ticket, FileCheck, Search, Send, Snowflake, ChevronDown } from "lucide-react";
import { normalizeTelegramContact, openTelegramContact } from "../lib/telegram";
import { useClients, useClientDirectory } from "../hooks/useClients";
import { useDisciplines } from "../hooks/useDisciplines";
import { usePrices } from "../hooks/usePrices";
import {
  computeSubscriptionAttendanceStats,
  useAttendanceRecords,
} from "../hooks/useAttendance";
import { usePersonalLessons } from "../hooks/usePersonalLessons";
import {
  useAddSubscription,
  useFinishSubscription,
  useSubscriptions,
} from "../hooks/useSubscriptions";
import {
  getConnectionBlockReason,
  getMutationBlockedMessage,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { usePermissions } from "../hooks/usePermissions";
import { formatClientName, formatCurrency, deriveSubscriptionTypeFromTariff, getGroupTariffs, getPriceLabel, getSubscriptionTariffLabel, tariffNeedsSecondClient } from "../lib/utils";
import { DEFAULT_ORG_MODULES, filterGroupTariffsByModules } from "../lib/orgModules";
import { useSettings } from "../settings/SettingsProvider";
import { useUIStore } from "../store/ui";
import ClientAutocomplete from "./ui/ClientAutocomplete";
import AppSelect from "./ui/AppSelect";
import ConfirmDialog from "./ui/ConfirmDialog";
import DisciplineSelect from "./ui/DisciplineSelect";
import LoadingState from "./ui/LoadingState";
import QueryErrorState from "./ui/QueryErrorState";
import PageTabs, { pageTabPanelCls } from "./ui/PageTabs";
import RequirePermission from "./RequirePermission";
import type { ToastType } from "../App";
import type { Client, Discipline } from "../types";

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
  const { connectionState } = useOnlineStatus();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);

  const activeClientsQuery = useClients();
  const directoryClientsQuery = useClientDirectory();
  const disciplinesQuery = useDisciplines();
  const subscriptionsQuery = useSubscriptions();
  const pricesQuery = usePrices();
  const attendanceQuery = useAttendanceRecords();
  const personalLessonsQuery = usePersonalLessons();
  const { data: activeClients = [], isLoading: activeClientsLoading, isError: activeClientsError, error: activeClientsErr } = activeClientsQuery;
  const { data: directoryClients = [], isLoading: directoryClientsLoading, isError: directoryClientsError, error: directoryClientsErr } = directoryClientsQuery;
  const { data: disciplines = [], isLoading: disciplinesLoading, isError: disciplinesError, error: disciplinesErr } = disciplinesQuery;
  const { data: subscriptions = [], isLoading: subsLoading, isError: subsError, error: subsErr } = subscriptionsQuery;
  const { data: prices = [], isLoading: pricesLoading, isError: pricesError, error: pricesErr } = pricesQuery;
  const {
    data: attendanceRecords = [],
    isLoading: attendanceLoading,
    isError: attendanceError,
    error: attendanceErr,
  } = attendanceQuery;
  const {
    data: personalLessons = [],
    isLoading: personalLessonsLoading,
    isError: personalLessonsError,
    error: personalLessonsErr,
  } = personalLessonsQuery;
  const addSubscription = useAddSubscription();
  const finishSubscription = useFinishSubscription();
  const { canAccessPanel } = usePermissions();
  const { settings } = useSettings();

  const isLoading =
    activeClientsLoading ||
    directoryClientsLoading ||
    disciplinesLoading ||
    subsLoading ||
    pricesLoading ||
    attendanceLoading ||
    personalLessonsLoading;
  const isError =
    activeClientsError ||
    directoryClientsError ||
    disciplinesError ||
    subsError ||
    pricesError ||
    attendanceError ||
    personalLessonsError;
  const error =
    activeClientsErr ??
    directoryClientsErr ??
    disciplinesErr ??
    subsErr ??
    pricesErr ??
    attendanceErr ??
    personalLessonsErr;
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
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);

  // Sale form states
  const groupTariffs = filterGroupTariffsByModules(
    getGroupTariffs(prices),
    settings?.modules ?? DEFAULT_ORG_MODULES
  );
  const [selectedTariffId, setSelectedTariffId] = useState<string | "">("");

  const [client1Query, setClient1Query] = useState("");
  const [client1Id, setClient1Id] = useState("");
  const [client2Query, setClient2Query] = useState("");
  const [client2Id, setClient2Id] = useState("");
  const [disciplineId, setDisciplineId] = useState<string | "">("");

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

  useEffect(() => {
    if (selectedTariffId && !groupTariffs.some((p) => p.id === selectedTariffId)) {
      setSelectedTariffId("");
      setClient2Id("");
      setClient2Query("");
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
    if (connectionState !== "online") {
      toast(getMutationBlockedMessage(connectionState), "error");
      return;
    }
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
      disciplineId,
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
    if (connectionState !== "online") {
      toast(getMutationBlockedMessage(connectionState), "error");
      return;
    }
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

  const clientMap = useMemo(
    () => Object.fromEntries(directoryClients.map((c) => [c.id, c])) as Record<string, Client>,
    [directoryClients]
  );
  const disciplineMap = useMemo(
    () => Object.fromEntries(disciplines.map((d) => [d.id, d])) as Record<number, Discipline>,
    [disciplines]
  );

  const attendanceStatsBySubId = useMemo(
    () => computeSubscriptionAttendanceStats(attendanceRecords, personalLessons),
    [attendanceRecords, personalLessons]
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
    ...(canAccessPanel("subscriptions_sell")
      ? [{ id: "sell" as const, label: "Продажа", icon: Ticket }]
      : []),
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

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
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

                const isExpanded = expandedSubId === sub.id;
                const attendanceStats = attendanceStatsBySubId[sub.id] ?? { visits: 0, absences: 0 };

                return (
                  <div
                    key={sub.id}
                    className={`border rounded-xl bg-white transition-all ${
                      isExpanded
                        ? "border-indigo-200 shadow-sm p-5"
                        : "border-slate-200 p-4 hover:border-indigo-200 hover:shadow-sm"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedSubId(isExpanded ? null : sub.id)}
                      className="w-full text-left cursor-pointer space-y-2"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-800 leading-tight min-w-0">
                          {clientNameStr}
                        </h3>
                        <ChevronDown
                          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-slate-400">Осталось занятий</span>
                          <span className="font-sans font-semibold text-slate-800">
                            {sub.lessonsLeft}{" "}
                            <span className="text-slate-400 font-normal">из {sub.lessonsTotal}</span>
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
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-slate-100 space-y-4 animate-fade-in">
                        <div className="space-y-3">
                          <div className="space-y-1">
                            <p className="text-[11px] font-sans font-semibold text-indigo-700 leading-snug">
                              {tariffLabel}
                            </p>
                            <div className="flex items-center gap-2 flex-wrap">
                              {sub.category === "private" ? (
                                <span className="text-[10px] font-sans font-semibold tracking-wider uppercase text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                  персональный
                                </span>
                              ) : disciplineName ? (
                                <span className="text-[10px] font-sans font-semibold tracking-wider uppercase text-slate-500">
                                  {disciplineName}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <p className="text-[11px] text-slate-400 font-sans">
                              Активирован: {sub.activationDate || "—"}
                            </p>
                            <p className="text-[11px] text-slate-400 font-sans">
                              Посещений: {attendanceStats.visits} · Пропусков: {attendanceStats.absences}
                            </p>

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

                          <div className="flex gap-2 flex-wrap">
                            {c1?.telegram && normalizeTelegramContact(c1.telegram) && (
                              <a
                                href={normalizeTelegramContact(c1.telegram)!}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
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
                                  e.stopPropagation();
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
                                  e.stopPropagation();
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

                        <div className="flex items-center justify-between pt-1 text-xs">
                          {isAlarm ? (
                            <span className="text-rose-600 font-semibold">Пора предложить продление</span>
                          ) : (
                            <span className="text-slate-400">Баланс в норме</span>
                          )}

                          <RequirePermission action="subscriptions.write">
                          <button
                            type="button"
                            onClick={() => setFinishTarget({ id: sub.id, name: clientNameStr })}
                            disabled={connectionState !== "online"}
                            title={getConnectionBlockReason(connectionState)}
                            className="text-slate-400 hover:text-rose-600 hover:underline cursor-pointer transition-colors uppercase text-[10px] font-sans font-semibold disabled:opacity-60 disabled:cursor-not-allowed disabled:no-underline"
                          >
                            Завершить
                          </button>
                          </RequirePermission>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* PANEL 2: SELL NEW SUBSCRIPTION */
        <div className="bg-white p-4 border border-slate-200 shadow-xs panel-card-stack panel-sell-under-tabs">
          <div className="panel-form-header panel-form-header-wide-md">
            <div className="panel-form-header-icon">
              <Ticket className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="panel-form-header-text">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">Продажа абонемента</h2>
              <p className="text-slate-400 text-[11px] leading-snug">
                Оформите новый групповой абонемент — запись сразу попадёт в базу.
              </p>
            </div>
          </div>

          <div className="panel-form-stack panel-form-stack-wide-md panel-form-stack-compact">
            <div className="field-stack">
              <label className={labelCls}>ТАРИФ АБОНЕМЕНТА</label>
              {groupTariffs.length === 0 ? (
                <p className="text-xs text-slate-400 font-sans">Нет групповых тарифов в прайс-листе.</p>
              ) : (
                <AppSelect
                  value={selectedTariffId}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) return;
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

            <div className="panel-form-full-row-md">
              <ClientAutocomplete
                label={needsSecondClient ? "Первый клиент" : "Клиент"}
                clients={activeClients}
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
            </div>

            {needsSecondClient && (
              <div className="animate-fade-in panel-form-full-row-md">
                <ClientAutocomplete
                  label="Второй клиент"
                  clients={activeClients}
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

            <div className="border-t border-slate-100 pt-1 -mt-0.5 panel-form-full-row-md" />

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

            <div className="panel-form-divider panel-form-full-row-md" />

            <div className="flex items-center justify-between p-3 bg-indigo-50/60 rounded-xl border border-indigo-100 panel-form-full-row-md">
              <span className="text-slate-600 font-semibold text-sm">Итого к оплате</span>
              <span className="text-xl font-sans font-semibold text-indigo-700">
                {getSubPrice() > 0 ? formatCurrency(getSubPrice()) : "тариф не настроен"}
              </span>
            </div>
            <p className="text-slate-400 text-xs font-sans text-center -mt-1 panel-form-full-row-md">
              Для изменения стоимости абонемента перейдите в раздел{" "}
              <button
                type="button"
                onClick={() => navigate("/prices")}
                className="text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer font-semibold"
              >
                Прайс-лист
              </button>
            </p>

            <div className="panel-form-divider panel-form-full-row-md" />

            <button
              onClick={handleCheckout}
              disabled={connectionState !== "online" || addSubscription.isPending}
              title={getConnectionBlockReason(connectionState)}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60 panel-form-full-row-md"
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
