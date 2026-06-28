/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Ticket, FileCheck, Search, Send, Snowflake, ChevronDown, ChevronLeft, ChevronRight, History } from "lucide-react";
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
import { useSubscriptionGroups } from "../hooks/useSubscriptionGroups";
import { useScheduleGroups } from "../hooks/useScheduleGroups";
import { useRecordSubscriptionPayment, PAYMENT_METHODS, getPaymentMethodLabel } from "../hooks/usePayments";
import type { PaymentMethod } from "../types";
import {
  translateConnectionBlockReason,
  translateMutationBlockedMessage,
  useOnlineStatus,
} from "../hooks/useOnlineStatus";
import { usePermissions } from "../hooks/usePermissions";
import { useI18n } from "../hooks/useI18n";
import { formatClientName, formatCurrency, deriveSubscriptionTypeFromTariff, filterGroupTariffsForSale, getPriceLabel, getSubscriptionDaysLeft, getSubscriptionTariffLabel, isMonthlyUnlimitedSubscription, isMonthlyUnlimitedTariff, tariffNeedsSecondClient, currentYearMonth, currentYear, shiftMonth, formatMonthTitle } from "../lib/utils";
import { filterActiveSubscriptions, filterHistorySubscriptions, ALL_LOCATIONS_KEY } from "../lib/subscriptionFilters";
import { buildGroupNameById, getSubscriptionGroupDisplayNames, listScheduleGroupOptions } from "../lib/scheduleGroups";
import { useAccessibleLocations } from "../hooks/useLocations";
import { DEFAULT_ORG_MODULES, filterGroupTariffsByModules, normalizeOrgModules, shouldShowDisciplinePicker, shouldShowLocationPicker } from "../lib/orgModules";
import { useSettings } from "../settings/SettingsProvider";
import { useOrganization } from "../organization/OrganizationProvider";
import { useUIStore } from "../store/ui";
import { resolveMutationError } from "../lib/resolveMutationError";
import ClientAutocomplete from "./ui/ClientAutocomplete";
import AppSelect from "./ui/AppSelect";
import ConfirmDialog from "./ui/ConfirmDialog";
import DatePickerField from "./ui/DatePickerField";
import DisciplineSelect from "./ui/DisciplineSelect";
import LocationSelect from "./ui/LocationSelect";
import GroupCheckboxDropdown from "./ui/GroupCheckboxDropdown";
import LoadingState from "./ui/LoadingState";
import AddDisciplinesInSettingsHint from "./ui/AddDisciplinesInSettingsHint";
import AddLocationsInSettingsHint from "./ui/AddLocationsInSettingsHint";
import QueryErrorState from "./ui/QueryErrorState";
import PageTabs, { pageTabPanelCls } from "./ui/PageTabs";
import RequirePermission from "./RequirePermission";
import type { ToastType } from "../App";
import type { Client, Discipline, Price, Subscription } from "../types";
import type { I18nKey } from "../lib/i18n/keys";

const NO_DISCIPLINE_KEY = "__none__";
const checkboxCls = "rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";

interface SubscriptionsPanelProps {
  initialTab?: "active" | "sell" | "history";
  toast: (msg: string, type?: ToastType) => void;
}

const labelCls = "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

export default function SubscriptionsPanel({
  initialTab = "active",
  toast,
}: SubscriptionsPanelProps) {
  const { t, plural, locale } = useI18n();
  const navigate = useNavigate();
  const { connectionState } = useOnlineStatus();
  const setSubscriptionsTab = useUIStore((s) => s.setSubscriptionsTab);

  const activeClientsQuery = useClients();
  const directoryClientsQuery = useClientDirectory();
  const disciplinesQuery = useDisciplines();
  const subscriptionsQuery = useSubscriptions();
  const subscriptionGroupsQuery = useSubscriptionGroups();
  const scheduleGroupsQuery = useScheduleGroups();
  const pricesQuery = usePrices();
  const attendanceQuery = useAttendanceRecords();
  const personalLessonsQuery = usePersonalLessons();
  const { data: activeClients = [], isLoading: activeClientsLoading, isError: activeClientsError, error: activeClientsErr } = activeClientsQuery;
  const { data: directoryClients = [], isLoading: directoryClientsLoading, isError: directoryClientsError, error: directoryClientsErr } = directoryClientsQuery;
  const { data: disciplines = [], isLoading: disciplinesLoading, isError: disciplinesError, error: disciplinesErr } = disciplinesQuery;
  const { data: subscriptions = [], isLoading: subsLoading, isError: subsError, error: subsErr } = subscriptionsQuery;
  const {
    groupsBySubId,
    isLoading: subscriptionGroupsLoading,
    isError: subscriptionGroupsError,
    error: subscriptionGroupsErr,
  } = subscriptionGroupsQuery;
  const {
    data: scheduleGroups = [],
    isLoading: scheduleGroupsLoading,
    isError: scheduleGroupsError,
    error: scheduleGroupsErr,
  } = scheduleGroupsQuery;
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
  const recordSubscriptionPayment = useRecordSubscriptionPayment();
  const { canAccessPanel } = usePermissions();
  const { settings } = useSettings();
  const { role, memberId } = useOrganization();
  const {
    locations,
    isLoading: locationsLoading,
    isError: locationsError,
    error: locationsErr,
  } = useAccessibleLocations();

  const isLoading =
    activeClientsLoading ||
    directoryClientsLoading ||
    disciplinesLoading ||
    subsLoading ||
    subscriptionGroupsLoading ||
    scheduleGroupsLoading ||
    pricesLoading ||
    attendanceLoading ||
    personalLessonsLoading ||
    locationsLoading;
  const isError =
    activeClientsError ||
    directoryClientsError ||
    disciplinesError ||
    subsError ||
    subscriptionGroupsError ||
    scheduleGroupsError ||
    pricesError ||
    attendanceError ||
    personalLessonsError ||
    locationsError;
  const error =
    activeClientsErr ??
    directoryClientsErr ??
    disciplinesErr ??
    subsErr ??
    subscriptionGroupsErr ??
    scheduleGroupsErr ??
    pricesErr ??
    attendanceErr ??
    personalLessonsErr ??
    locationsErr;
  const [activeTab, setActiveTab] = useState<"sell" | "active" | "history">(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const switchTab = (tab: "active" | "sell" | "history") => {
    setActiveTab(tab);
    setSubscriptionsTab(tab);
    const path =
      tab === "sell" ? "/subscriptions/sell" : tab === "history" ? "/subscriptions/history" : "/subscriptions";
    navigate(path);
  };

  const [search, setSearch] = useState("");
  const [activeLocationFilter, setActiveLocationFilter] = useState("");
  const [activeDisciplineFilter, setActiveDisciplineFilter] = useState("");
  const [activeGroupFilter, setActiveGroupFilter] = useState("");
  const [endingOnlyFilter, setEndingOnlyFilter] = useState(false);
  const [historyDisciplineId, setHistoryDisciplineId] = useState("");
  const [historyLocationId, setHistoryLocationId] = useState("");
  const [historyClientId, setHistoryClientId] = useState("");
  const [historyMonth, setHistoryMonth] = useState(currentYearMonth);
  const [historyYear, setHistoryYear] = useState(currentYear);
  const [expandedSubId, setExpandedSubId] = useState<string | null>(null);
  const [expandedDisciplines, setExpandedDisciplines] = useState<Set<string>>(new Set());

  // Sale form states
  const [localPriceList, setLocalPriceList] = useState(false);
  const [saleLocationId, setSaleLocationId] = useState<string | "">("");
  const [selectedTariffId, setSelectedTariffId] = useState<string | "">("");

  const [client1Query, setClient1Query] = useState("");
  const [client1Id, setClient1Id] = useState("");
  const [client2Query, setClient2Query] = useState("");
  const [client2Id, setClient2Id] = useState("");
  const [disciplineId, setDisciplineId] = useState<string | "">("");
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);

  const groupTariffs = filterGroupTariffsByModules(
    filterGroupTariffsForSale(prices, {
      localPriceList,
      locationId: localPriceList ? saleLocationId || null : null,
      disciplineId: disciplineId || null,
      teacherMemberId: role === "teacher" ? memberId : null,
    }),
    settings?.modules ?? DEFAULT_ORG_MODULES
  );

  useEffect(() => {
    if (disciplines.length > 0 && disciplineId === "") {
      setDisciplineId(disciplines[0].id);
    }
  }, [disciplines, disciplineId]);

  useEffect(() => {
    if (locations.length > 0 && saleLocationId === "") {
      setSaleLocationId(locations[0].id);
    }
  }, [locations, saleLocationId]);

  useEffect(() => {
    if (!localPriceList) return;
    if (saleLocationId && !locations.some((l) => l.id === saleLocationId)) {
      setSaleLocationId(locations[0]?.id ?? "");
    }
  }, [localPriceList, locations, saleLocationId]);

  // Early-finish confirmation target
  const [finishTarget, setFinishTarget] = useState<{ id: string; name: string } | null>(null);

  // Date activation - defaults to today
  const [activationDate, setActivationDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

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
  }, [groupTariffs, selectedTariffId, disciplineId]);

  const saleGroupOptions = useMemo(
    () =>
      listScheduleGroupOptions(scheduleGroups, {
        disciplineId: disciplineId || null,
        locationId: localPriceList ? saleLocationId || null : null,
      }).map((group) => ({ key: group.id, label: group.displayName })),
    [scheduleGroups, disciplineId, localPriceList, saleLocationId]
  );

  const activeLocationGroupOptions = useMemo(
    () =>
      activeLocationFilter
        ? listScheduleGroupOptions(scheduleGroups, { locationId: activeLocationFilter }).map((group) => ({
            key: group.id,
            label: group.displayName,
          }))
        : [],
    [scheduleGroups, activeLocationFilter]
  );

  const groupNameById = useMemo(() => buildGroupNameById(scheduleGroups), [scheduleGroups]);

  useEffect(() => {
    setSelectedGroupIds((prev) => prev.filter((id) => saleGroupOptions.some((option) => option.key === id)));
  }, [saleGroupOptions]);

  useEffect(() => {
    setActiveGroupFilter("");
  }, [activeLocationFilter, activeDisciplineFilter]);

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
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    if (!selectedTariff?.id) {
      toast(t("subscriptions.error.selectTariff"), "error");
      return;
    }

    if (!client1Query || !client1Id) {
      toast(t("subscriptions.error.selectClient"), "error");
      return;
    }

    if (needsSecondClient && (!client2Query || !client2Id)) {
      toast(t("subscriptions.error.selectSecondClient"), "error");
      return;
    }

    if (needsSecondClient && client1Id === client2Id) {
      toast(t("subscriptions.error.sameClients"), "error");
      return;
    }

    if (!disciplineId) {
      toast(t("subscriptions.error.selectDiscipline"), "error");
      return;
    }

    if (!activationDate) {
      toast(t("subscriptions.error.activationDate"), "error");
      return;
    }

    if (selectedGroupIds.length === 0) {
      toast(t("subscriptions.error.selectGroups"), "error");
      return;
    }

    const { type, pairMonth, billingModel } = deriveSubscriptionTypeFromTariff(selectedTariff);

    const payload = {
      type,
      clientId1: client1Id,
      clientId2: needsSecondClient ? client2Id : "",
      lessonsTotal: billingModel === "monthly_unlimited" ? 0 : selectedTariff.lessons,
      activationDate,
      pairMonth,
      disciplineId,
      priceId: selectedTariff.id,
      category: "group" as const,
      billingModel,
      scheduleGroupIds: selectedGroupIds,
    };

    const res = await addSubscription.mutateAsync(payload);
    if (!res.success) {
      toast(resolveMutationError(res.error, "subscriptions.error.sellFailed", t), "error");
      return;
    }

    const amount = getSubPrice();
    if (amount > 0 && res.id) {
      const c1 = activeClients.find((c) => c.id === client1Id);
      const paymentRes = await recordSubscriptionPayment.mutateAsync({
        subscriptionId: res.id,
        clientId: client1Id,
        clientFirstName: c1?.firstName ?? "",
        clientLastName: c1?.lastName ?? "",
        amount,
        method: paymentMethod,
      });
      if (!paymentRes.success) {
        toast(resolveMutationError(paymentRes.error, "subscriptions.error.paymentFailed", t), "error");
        return;
      }
    }

    toast(t("subscriptions.success.sold"), "success");
    setClient1Query("");
    setClient1Id("");
    setClient2Query("");
    setClient2Id("");
    setSelectedGroupIds([]);
  };

  const handleConfirmFinish = async () => {
    if (!finishTarget) return;
    if (connectionState !== "online") {
      toast(translateMutationBlockedMessage(connectionState, t)!, "error");
      return;
    }
    const res = await finishSubscription.mutateAsync(finishTarget.id);
    if (!res.success) {
      toast(resolveMutationError(res.error, "subscriptions.error.finishFailed", t), "error");
    } else {
      toast(t("subscriptions.success.finished"), "success");
      setFinishTarget(null);
    }
  };

  // Directory filter for active records (lowest balance first)
  const activeRecords = subscriptions
    .filter((s) => s.status === "active")
    .sort((a, b) => {
      if (isMonthlyUnlimitedSubscription(a) && isMonthlyUnlimitedSubscription(b)) {
        return getSubscriptionDaysLeft(a.expiresAt) - getSubscriptionDaysLeft(b.expiresAt);
      }
      if (isMonthlyUnlimitedSubscription(a)) return -1;
      if (isMonthlyUnlimitedSubscription(b)) return 1;
      return a.lessonsLeft - b.lessonsLeft;
    });

  const clientMap = useMemo(
    () => Object.fromEntries(directoryClients.map((c) => [c.id, c])) as Record<string, Client>,
    [directoryClients]
  );
  const disciplineMap = useMemo(
    () => Object.fromEntries(disciplines.map((d) => [d.id, d])) as Record<string, Discipline>,
    [disciplines]
  );
  const orgModules = normalizeOrgModules(settings?.modules);
  const showLocationFilter = shouldShowLocationPicker(orgModules, locations.length);
  const showDisciplineFilter = shouldShowDisciplinePicker(orgModules, disciplines.length);
  const priceMap = useMemo(
    () =>
      Object.fromEntries(
        prices.filter((p): p is Price & { id: string } => Boolean(p.id)).map((p) => [p.id!, p])
      ) as Record<string, Price>,
    [prices]
  );

  const attendanceStatsBySubId = useMemo(
    () => computeSubscriptionAttendanceStats(attendanceRecords, personalLessons),
    [attendanceRecords, personalLessons]
  );

  const filteredActiveRecords = useMemo(
    () =>
      filterActiveSubscriptions(activeRecords, {
        search,
        clientMap,
        locationId: activeLocationFilter,
        disciplineId: activeDisciplineFilter,
        scheduleGroupId: activeGroupFilter,
        endingOnly: endingOnlyFilter,
        priceMap,
        groupsBySubId,
      }),
    [
      activeRecords,
      search,
      clientMap,
      activeLocationFilter,
      activeDisciplineFilter,
      activeGroupFilter,
      endingOnlyFilter,
      priceMap,
      groupsBySubId,
    ]
  );

  const historyRecords = useMemo(
    () =>
      filterHistorySubscriptions(subscriptions, {
        disciplineId: historyDisciplineId,
        locationId: historyLocationId,
        clientId: historyClientId,
        month: historyMonth,
        year: historyYear,
        priceMap,
      }),
    [
      subscriptions,
      historyDisciplineId,
      historyLocationId,
      historyClientId,
      historyMonth,
      historyYear,
      priceMap,
    ]
  );

  const hasHistoryFilter = Boolean(historyDisciplineId || historyLocationId || historyClientId);
  const isViewingCurrentHistoryMonth = historyMonth === currentYearMonth();
  const isViewingCurrentHistoryYear = historyYear === currentYear();

  const disciplineGroups = useMemo(() => {
    const groups = new Map<string, Subscription[]>();
    for (const sub of filteredActiveRecords) {
      const key = sub.disciplineId ?? NO_DISCIPLINE_KEY;
      const bucket = groups.get(key) ?? [];
      bucket.push(sub);
      groups.set(key, bucket);
    }

    return Array.from(groups.entries()).sort(([keyA], [keyB]) => {
      const nameA =
        keyA === NO_DISCIPLINE_KEY ? t("utils.noDiscipline") : disciplineMap[keyA]?.name ?? "";
      const nameB =
        keyB === NO_DISCIPLINE_KEY ? t("utils.noDiscipline") : disciplineMap[keyB]?.name ?? "";
      return nameA.localeCompare(nameB, "ru");
    });
  }, [filteredActiveRecords, disciplineMap, t]);

  const toggleDiscipline = (key: string) => {
    setExpandedDisciplines((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (isLoading) return <LoadingState label={t("subscriptions.loading")} />;
  if (isError) return <QueryErrorState error={error} />;

  const subscriptionCountKey = (count: number) =>
    plural(count, ["subscriptions.count.one", "subscriptions.count.few", "subscriptions.count.many"]) as I18nKey;

  const subscriptionTabs = [
    { id: "active", label: t("subscriptions.tab.active"), icon: FileCheck },
    ...(canAccessPanel("subscriptions_sell")
      ? [{ id: "sell" as const, label: t("subscriptions.tab.sell"), icon: Ticket }]
      : []),
    { id: "history", label: t("subscriptions.tab.history"), icon: History },
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
              <h2 className="text-lg font-semibold tracking-tight text-slate-800">{t("subscriptions.activeTitle")}</h2>
              <p className="text-xs text-slate-400 mt-1">
                {t("subscriptions.activeHint")}
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("subscriptions.search.placeholder")}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-100 outline-none rounded-lg text-xs transition-all"
                />
              </div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {showLocationFilter && (
            <AppSelect
              label={t("subscriptions.filter.location")}
              value={activeLocationFilter}
              onChange={(e) => setActiveLocationFilter(e.target.value)}
            >
              <option value="">{t("subscriptions.filter.all")}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </AppSelect>
            )}

            {showDisciplineFilter && (
            <AppSelect
              label={t("subscriptions.filter.discipline")}
              value={activeDisciplineFilter}
              onChange={(e) => setActiveDisciplineFilter(e.target.value)}
            >
              <option value="">{t("subscriptions.filter.allDisciplines")}</option>
              {disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </AppSelect>
            )}

            {activeLocationFilter ? (
              <AppSelect
                label={t("subscriptions.filter.groups")}
                value={activeGroupFilter}
                onChange={(e) => setActiveGroupFilter(e.target.value)}
              >
                <option value="">{t("subscriptions.filter.allGroups")}</option>
                {activeLocationGroupOptions.map((group) => (
                  <option key={group.key} value={group.key}>
                    {group.label}
                  </option>
                ))}
              </AppSelect>
            ) : null}

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer sm:col-span-2 lg:col-span-1 lg:self-end lg:pb-2">
              <input
                type="checkbox"
                checked={endingOnlyFilter}
                onChange={(e) => setEndingOnlyFilter(e.target.checked)}
                className={checkboxCls}
              />
              <span className="font-semibold">{t("subscriptions.filter.expiring")}</span>
            </label>
          </div>

          <div className="space-y-3">
            {filteredActiveRecords.length === 0 ? (
              <div className="text-center py-20 text-slate-400 space-y-3">
                <Ticket className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm">
                  {search.trim() || activeLocationFilter || activeDisciplineFilter || activeGroupFilter || endingOnlyFilter
                    ? t("subscriptions.empty.filtered")
                    : t("subscriptions.empty.none")}
                </p>
                {!search.trim() && !activeLocationFilter && !activeDisciplineFilter && !activeGroupFilter && !endingOnlyFilter && (
                  <button
                    onClick={() => switchTab("sell")}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    {t("subscriptions.sellFirstLink")}
                  </button>
                )}
              </div>
            ) : (
              disciplineGroups.map(([disciplineKey, subsInGroup]) => {
                const disciplineName =
                  disciplineKey === NO_DISCIPLINE_KEY
                    ? t("utils.noDiscipline")
                    : disciplineMap[disciplineKey]?.name ?? t("utils.noDiscipline");
                const isDisciplineExpanded = expandedDisciplines.has(disciplineKey);

                return (
                  <div
                    key={disciplineKey}
                    className="border border-slate-200 rounded-xl overflow-hidden bg-white"
                  >
                    <button
                      type="button"
                      onClick={() => toggleDiscipline(disciplineKey)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-left"
                      aria-expanded={isDisciplineExpanded}
                    >
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-slate-800 truncate">{disciplineName}</h3>
                        <p className="text-[11px] text-slate-400 font-sans mt-0.5">
                          {t(subscriptionCountKey(subsInGroup.length), { count: subsInGroup.length })}
                        </p>
                      </div>
                      <ChevronDown
                        className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                          isDisciplineExpanded ? "rotate-180" : ""
                        }`}
                      />
                    </button>

                    {isDisciplineExpanded && (
                      <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3 border-t border-slate-100">
                        {subsInGroup.map((sub) => {
                const c1 = clientMap[sub.clientId1];
                const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
                const c3 = sub.clientId3 ? clientMap[sub.clientId3] : null;

                const clientNameStr = [c1, c2, c3]
                  .filter(Boolean)
                  .map((c) => `${c!.lastName || ""} ${c!.firstName || ""}`.trim())
                  .join(" & ");

                const isMonthly = isMonthlyUnlimitedSubscription(sub);
                const daysLeft = isMonthly ? getSubscriptionDaysLeft(sub.expiresAt) : null;
                const progressPct = isMonthly
                  ? sub.expiresAt
                    ? Math.max(
                        0,
                        Math.min(
                          100,
                          (daysLeft ?? 0) /
                            Math.max(
                              1,
                              getSubscriptionDaysLeft(sub.expiresAt, sub.activationDate) || 30
                            ) *
                            100
                        )
                      )
                    : 0
                  : sub.lessonsTotal > 0
                    ? (sub.lessonsLeft / sub.lessonsTotal) * 100
                    : 0;
                const isAlarm = isMonthly ? (daysLeft ?? 0) <= 2 : sub.lessonsLeft <= 2;

                const disciplineName =
                  sub.disciplineId != null ? disciplineMap[sub.disciplineId]?.name : undefined;

                const tariffLabel = getSubscriptionTariffLabel(sub, prices);
                const linkedGroupNames = getSubscriptionGroupDisplayNames(sub.id, groupsBySubId, groupNameById);

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
                          <span className="text-slate-400">
                            {isMonthly ? t("subscriptions.remaining.days") : t("subscriptions.remaining.lessons")}
                          </span>
                          <span className="font-sans font-semibold text-slate-800">
                            {isMonthly ? (
                              <>
                                {daysLeft ?? 0}{" "}
                                <span className="text-slate-400 font-normal">
                                  {t(
                                    plural(daysLeft ?? 0, ["common.day.one", "common.day.few", "common.day.many"]) as I18nKey
                                  )}
                                </span>
                              </>
                            ) : (
                              <>
                                {sub.lessonsLeft}{" "}
                                <span className="text-slate-400 font-normal">
                                  {t("common.of")} {sub.lessonsTotal}
                                </span>
                              </>
                            )}
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

                      {linkedGroupNames.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {linkedGroupNames.map((groupName) => (
                            <span
                              key={groupName}
                              className="text-[10px] font-sans font-semibold tracking-wide text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100"
                            >
                              {groupName}
                            </span>
                          ))}
                        </div>
                      ) : null}
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
                                  {t("subscriptions.card.personal")}
                                </span>
                              ) : disciplineName ? (
                                <span className="text-[10px] font-sans font-semibold tracking-wider uppercase text-slate-500">
                                  {disciplineName}
                                </span>
                              ) : null}
                              {linkedGroupNames.map((groupName) => (
                                <span
                                  key={`${sub.id}-${groupName}`}
                                  className="text-[10px] font-sans font-semibold tracking-wide text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100"
                                >
                                  {groupName}
                                </span>
                              ))}
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <p className="text-[11px] text-slate-400 font-sans">
                              {t("subscriptions.card.activated", { date: sub.activationDate || "—" })}
                            </p>
                            <p className="text-[11px] text-slate-400 font-sans">
                              {t("subscriptions.card.visits", {
                                visits: attendanceStats.visits,
                                absences: attendanceStats.absences,
                              })}
                            </p>

                            {sub.lessonsTotal === 8 && !isMonthly ? (
                              sub.freezeUsed > 0 ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-sans text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-200">
                                  <Snowflake className="w-3 h-3" /> {t("subscriptions.card.freezeUsed")}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[10px] font-sans text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-100">
                                  <Snowflake className="w-3 h-3" /> {t("subscriptions.card.freezeAvailable")}
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
                          {isMonthly ? (
                            <span className="text-slate-400">{t("subscriptions.card.expiresAt", { date: sub.expiresAt || "—" })}</span>
                          ) : isAlarm ? (
                            <span className="text-rose-600 font-semibold">{t("subscriptions.card.suggestRenewal")}</span>
                          ) : (
                            <span className="text-slate-400">{t("subscriptions.card.balanceOk")}</span>
                          )}

                          <RequirePermission action="subscriptions.write">
                          <button
                            type="button"
                            onClick={() => setFinishTarget({ id: sub.id, name: clientNameStr })}
                            disabled={connectionState !== "online"}
                            title={translateConnectionBlockReason(connectionState, t)}
                            className="text-slate-400 hover:text-rose-600 hover:underline cursor-pointer transition-colors uppercase text-[10px] font-sans font-semibold disabled:opacity-60 disabled:cursor-not-allowed disabled:no-underline"
                          >
                            {t("subscriptions.confirm.finishConfirm")}
                          </button>
                          </RequirePermission>
                        </div>
                      </div>
                    )}
                  </div>
                );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : activeTab === "history" ? (
        <div
          className={`bg-white p-4 border border-slate-200 shadow-xs panel-card-stack ${pageTabPanelCls(activeTab, "active")}`}
        >
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-slate-800">{t("subscriptions.historyTitle")}</h2>
            <p className="text-xs text-slate-400 mt-1">
              {t("subscriptions.historyHint")}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {showDisciplineFilter && (
            <AppSelect
              label={t("subscriptions.filter.discipline")}
              value={historyDisciplineId}
              onChange={(e) => setHistoryDisciplineId(e.target.value)}
            >
              <option value="">{t("subscriptions.filter.notSelectedF")}</option>
              {disciplines.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </AppSelect>
            )}

            {showLocationFilter && (
            <AppSelect
              label={t("subscriptions.filter.location")}
              value={historyLocationId}
              onChange={(e) => setHistoryLocationId(e.target.value)}
            >
              <option value="">{t("subscriptions.filter.notSelectedF")}</option>
              <option value={ALL_LOCATIONS_KEY}>{t("subscriptions.filter.all")}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </AppSelect>
            )}

            <AppSelect
              label={t("subscriptions.sell.client")}
              value={historyClientId}
              onChange={(e) => setHistoryClientId(e.target.value)}
            >
              <option value="">{t("subscriptions.filter.notSelectedM")}</option>
              {[...directoryClients]
                .sort((a, b) =>
                  `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, locale)
                )
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {formatClientName(c.lastName, c.firstName)}
                  </option>
                ))}
            </AppSelect>
          </div>

          {hasHistoryFilter && !historyClientId && (
            <div className="flex items-center justify-between px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50/50 gap-2">
              <button
                type="button"
                onClick={() => setHistoryMonth((m) => shiftMonth(m, -1))}
                className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label={t("subscriptions.aria.prevMonth")}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col items-center gap-0.5 min-w-0">
                <span className="text-sm font-semibold text-slate-800">{formatMonthTitle(historyMonth, locale)}</span>
                {!isViewingCurrentHistoryMonth && (
                  <button
                    type="button"
                    onClick={() => setHistoryMonth(currentYearMonth())}
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    {t("subscriptions.history.currentMonth")}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setHistoryMonth((m) => shiftMonth(m, 1))}
                className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label={t("subscriptions.aria.nextMonth")}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {hasHistoryFilter && historyClientId && (
            <div className="flex items-center justify-between px-3 py-2.5 border border-slate-200 rounded-xl bg-slate-50/50 gap-2">
              <button
                type="button"
                onClick={() => setHistoryYear((y) => y - 1)}
                className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label={t("subscriptions.aria.prevYear")}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="flex flex-col items-center gap-0.5 min-w-0">
                <span className="text-sm font-semibold text-slate-800">
                  {historyYear}
                  {t("common.yearSuffix")}
                </span>
                {!isViewingCurrentHistoryYear && (
                  <button
                    type="button"
                    onClick={() => setHistoryYear(currentYear())}
                    className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                  >
                    {t("subscriptions.history.currentYear")}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setHistoryYear((y) => y + 1)}
                className="p-1.5 rounded-lg hover:bg-white text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                aria-label={t("subscriptions.aria.nextYear")}
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          <div className="space-y-2">
            {!hasHistoryFilter ? (
              <div className="text-center py-16 text-slate-400 space-y-2">
                <History className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm max-w-md mx-auto leading-relaxed">
                  {t("subscriptions.history.selectFilter")}
                </p>
              </div>
            ) : historyRecords.length === 0 ? (
              <div className="text-center py-16 text-slate-400 space-y-2">
                <Ticket className="w-8 h-8 mx-auto text-slate-300" />
                <p className="text-sm">{t("subscriptions.empty.filtered")}</p>
              </div>
            ) : (
              historyRecords.map((sub) => {
                const c1 = clientMap[sub.clientId1];
                const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
                const c3 = sub.clientId3 ? clientMap[sub.clientId3] : null;
                const clientNameStr = [c1, c2, c3]
                  .filter(Boolean)
                  .map((c) => `${c!.lastName || ""} ${c!.firstName || ""}`.trim())
                  .join(" & ");
                const disciplineName =
                  sub.disciplineId != null ? disciplineMap[sub.disciplineId]?.name : undefined;
                const tariffLabel = getSubscriptionTariffLabel(sub, prices);
                const isFinished = sub.lessonsLeft === 0 || sub.status === "finished";

                return (
                  <div
                    key={sub.id}
                    className="border border-slate-200 rounded-xl p-4 bg-white hover:border-indigo-200 transition-colors"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <h3 className="text-sm font-semibold text-slate-800">{clientNameStr}</h3>
                        <p className="text-[11px] font-sans font-semibold text-indigo-700">{tariffLabel}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          {disciplineName && (
                            <span className="text-[10px] font-sans font-semibold tracking-wider uppercase text-slate-500">
                              {disciplineName}
                            </span>
                          )}
                          <span
                            className={`text-[10px] font-sans font-semibold px-2 py-0.5 rounded border ${
                              isFinished
                                ? "text-slate-500 bg-slate-50 border-slate-200"
                                : "text-indigo-700 bg-indigo-50 border-indigo-100"
                            }`}
                          >
                            {isFinished ? t("subscriptions.status.finished") : t("subscriptions.status.active")}
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <p className="text-[11px] text-slate-400 font-sans">
                          {t("subscriptions.card.activated", { date: sub.activationDate || "—" })}
                        </p>
                        <p className="text-xs font-sans font-semibold text-slate-700">
                          {t("subscriptions.card.lessonsOf", { left: sub.lessonsLeft, total: sub.lessonsTotal })}
                        </p>
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
        <div className="bg-white p-4 border border-slate-200 shadow-xs panel-card-stack panel-sell-under-tabs">
          <div className="panel-form-header panel-form-header-wide-md">
            <div className="panel-form-header-icon">
              <Ticket className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="panel-form-header-text">
              <h2 className="text-base font-semibold tracking-tight text-slate-900">{t("subscriptions.sellTitle")}</h2>
              <p className="text-slate-400 text-[11px] leading-snug">
                {t("subscriptions.sellSubtitle")}
              </p>
            </div>
          </div>

          {locations.length === 0 ? (
            <div className="text-center py-20 text-slate-400 space-y-3">
              <Ticket className="w-8 h-8 mx-auto text-slate-300" />
              <AddLocationsInSettingsHint />
            </div>
          ) : (
          <div className="panel-form-stack panel-form-stack-wide-md panel-form-stack-compact">
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer panel-form-full-row-md">
              <input
                type="checkbox"
                checked={localPriceList}
                onChange={(e) => {
                  setLocalPriceList(e.target.checked);
                  setSelectedTariffId("");
                }}
                className={`${checkboxCls} mt-0.5`}
              />
              <span className="text-xs leading-snug">{t("subscriptions.sell.localPriceList")}</span>
            </label>

            {localPriceList && (
              <div className="field-stack panel-form-full-row-md animate-fade-in">
                {locations.length === 0 ? (
                  <AddLocationsInSettingsHint className="text-xs text-slate-400 font-sans leading-relaxed" />
                ) : (
                  <LocationSelect
                    label={t("subscriptions.filter.location")}
                    locations={locations}
                    value={saleLocationId}
                    onChange={(id) => {
                      setSaleLocationId(id);
                      setSelectedTariffId("");
                    }}
                  />
                )}
              </div>
            )}

            {(!localPriceList || (localPriceList && saleLocationId && locations.length > 0)) && (
            <div className="field-stack">
              <label className={labelCls}>{t("subscriptions.sell.tariffLabel")}</label>
              {groupTariffs.length === 0 ? (
                <p className="text-xs text-slate-400 font-sans leading-relaxed">
                  {localPriceList
                    ? t("subscriptions.sell.noTariffs")
                    : t("subscriptions.sell.noGlobalTariffs")}
                </p>
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
                      {getPriceLabel(tariff, t)}
                      {isMonthlyUnlimitedTariff(tariff)
                        ? t("subscriptions.sell.unlimitedMonth", { price: formatCurrency(tariff.price) })
                        : t("subscriptions.sell.lessonsPrice", {
                            lessons: tariff.lessons,
                            price: formatCurrency(tariff.price),
                          })}
                    </option>
                  ))}
                </AppSelect>
              )}
            </div>
            )}

            {disciplines.length === 0 ? (
              <AddDisciplinesInSettingsHint className="text-xs text-slate-400 font-sans leading-relaxed" />
            ) : (
              <DisciplineSelect
                disciplines={disciplines}
                value={disciplineId}
                onChange={(value) => {
                  setDisciplineId(value);
                  setSelectedGroupIds([]);
                }}
                toast={toast}
              />
            )}

            <GroupCheckboxDropdown
              label={t("subscriptions.sell.groupLessons")}
              options={saleGroupOptions}
              selectedKeys={selectedGroupIds}
              onChange={setSelectedGroupIds}
              placeholder={t("subscriptions.sell.selectGroups")}
              emptyMessage={
                disciplineId
                  ? t("subscriptions.sell.noGroupsForDiscipline")
                  : t("subscriptions.sell.selectDisciplineFirst")
              }
            />

            <DatePickerField
              label={t("subscriptions.sell.activationDate")}
              value={activationDate}
              onChange={setActivationDate}
              required
            />

            <div className="panel-form-full-row-md">
              <ClientAutocomplete
                label={needsSecondClient ? t("subscriptions.sell.firstClient") : t("subscriptions.sell.client")}
                clients={activeClients}
                query={client1Query}
                selectedId={client1Id}
                showAddClientButton
                addClientLinkLabel={t("subscriptions.sell.newClient")}
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
                  label={t("subscriptions.sell.secondClient")}
                  clients={activeClients}
                  query={client2Query}
                  selectedId={client2Id}
                  showAddClientButton
                  addClientLinkLabel={t("subscriptions.sell.newClient")}
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

            <div className="panel-form-full-row-md grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl md:max-w-none">
              <AppSelect
                label={t("subscriptions.sell.paymentMethod")}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {getPaymentMethodLabel(method, t)}
                  </option>
                ))}
              </AppSelect>

              <div className="field-stack">
                <span className={labelCls}>{t("subscriptions.sell.totalDue")}</span>
                <div className="flex items-center justify-between h-10 px-3 bg-indigo-50/60 rounded-lg border border-indigo-100">
                  <span className="text-lg font-sans font-semibold text-indigo-700">
                    {getSubPrice() > 0 ? formatCurrency(getSubPrice()) : "—"}
                  </span>
                </div>
              </div>
            </div>
            {role !== "teacher" && (
            <p className="text-slate-400 text-xs font-sans text-center -mt-1 panel-form-full-row-md">
              {t("subscriptions.sell.priceHint")}{" "}
              <button
                type="button"
                onClick={() => navigate("/prices")}
                className="text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer font-semibold"
              >
                {t("subscriptions.sell.priceListLink")}
              </button>
            </p>
            )}

            <div className="panel-form-divider panel-form-full-row-md" />

            <button
              onClick={handleCheckout}
              disabled={
                connectionState !== "online" ||
                addSubscription.isPending ||
                recordSubscriptionPayment.isPending
              }
              title={translateConnectionBlockReason(connectionState, t)}
              className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-sans text-xs font-semibold tracking-widest uppercase rounded-lg transition-colors shadow-xs cursor-pointer disabled:opacity-60 panel-form-full-row-md"
            >
              {addSubscription.isPending || recordSubscriptionPayment.isPending
                ? t("subscriptions.sell.submitPending")
                : t("subscriptions.sell.submit")}
            </button>
          </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={finishTarget !== null}
        title={t("subscriptions.confirm.finishTitle")}
        description={
          <>
            {t("subscriptions.confirm.finishBody", { name: finishTarget?.name ?? "" })}
          </>
        }
        confirmLabel={t("subscriptions.confirm.finishConfirm")}
        pending={finishSubscription.isPending}
        onConfirm={handleConfirmFinish}
        onCancel={() => setFinishTarget(null)}
      />
    </div>
  );
}
