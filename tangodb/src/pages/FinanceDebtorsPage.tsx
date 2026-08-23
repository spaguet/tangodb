import { useMemo, useState } from "react";
import { AlertCircle, CalendarDays, ChevronDown, Coins, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { useFinancialDebtors } from "../hooks/useFinancialDebtors";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "../App";
import { usePersonalLessonsModuleEnabled } from "../hooks/useOrgModules";
import { useLocations } from "../hooks/useLocations";
import { useDisciplines } from "../hooks/useDisciplines";
import { memberDisplayName, useTeamMembers } from "../hooks/useTeamMembers";
import {
  sortDebtors,
  sumDebtorAmounts,
  sumDebtorListAmounts,
  groupPersonalLessonDebtors,
  formatDebtorDetail,
  formatDebtorClock,
  formatDebtorLessonDuration,
  debtorAgingDays,
  debtorSchedulePath,
  type DebtorEntry,
  type DebtorListItem,
  type DebtorSortKey,
} from "../lib/financeReports";
import { formatCurrency } from "../lib/utils";
import { toISODateLocal } from "../lib/scheduleWeek";
import PayPersonalLessonModal, { type PayPersonalLessonTarget } from "../components/schedule/PayPersonalLessonModal";
import AdjustDebtorAmountDialog from "../components/finance/AdjustDebtorAmountDialog";
import DebtorLedgerTrace from "../components/finance/DebtorLedgerTrace";
import { btnAddCls, btnDestructiveOpenCls, btnOpenCls } from "../components/ui/buttonStyles";
import AppSelect from "../components/ui/AppSelect";

type DebtorTab = "all" | "clients" | "rentals";

const DEBTOR_SORT_OPTIONS: DebtorSortKey[] = [
  "dateAsc",
  "dateDesc",
  "nameAsc",
  "nameDesc",
  "amountDesc",
];

const MISSING = "—";

function debtorKindLabel(kind: DebtorEntry["kind"], t: ReturnType<typeof useI18n>["t"]): string {
  if (kind === "rental") return t("finance.debtors.kind.rental");
  if (kind === "personal") return t("finance.debtors.kind.personal");
  return t("finance.debtors.kind.subscription");
}

function DebtorDetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">{label}</dt>
      <dd className="text-xs text-slate-700 font-sans mt-0.5 break-words">{value}</dd>
    </div>
  );
}

function DebtorRow({
  item,
  expanded,
  onToggle,
  kindLabel,
  locationName,
  disciplineName,
  teacherName,
  agingLabel,
  schedulePath,
  canPayPersonal,
  canAdjust,
  onPayByTariff,
  onPayOutstanding,
  onAdjust,
  onAdjustMember,
  onWriteOff,
  formatDate,
  t,
}: {
  item: DebtorListItem;
  expanded: boolean;
  onToggle: () => void;
  kindLabel: string;
  locationName: string;
  disciplineName: string;
  teacherName: string;
  agingLabel: string;
  schedulePath: string | null;
  canPayPersonal: boolean;
  canAdjust: boolean;
  onPayByTariff: () => void;
  onPayOutstanding: () => void;
  onAdjust: () => void;
  onAdjustMember: (member: DebtorEntry) => void;
  onWriteOff: () => void;
  formatDate: ReturnType<typeof useI18n>["formatDate"];
  t: ReturnType<typeof useI18n>["t"];
}) {
  const entry = item.entry;
  const members = item.members;
  const isGroup = members.length > 1;
  const timeStart = formatDebtorClock(entry.lessonTimeStart) ?? MISSING;
  const timeEnd = formatDebtorClock(entry.lessonTimeEnd) ?? MISSING;
  const serviceDate = entry.lessonDate ? formatDate(entry.lessonDate) : MISSING;
  const amountLabel = entry.amount > 0 ? formatCurrency(entry.amount) : MISSING;
  const lessonDuration =
    entry.kind === "personal" ? formatDebtorLessonDuration(entry, t) ?? MISSING : null;
  const otherParticipants =
    entry.kind === "personal" && entry.otherParticipants?.trim()
      ? entry.otherParticipants.trim()
      : null;

  return (
    <div className="border-b border-slate-100 last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2 sm:gap-3 items-center px-3 py-3">
        <button type="button" onClick={onToggle} className="min-w-0 text-left cursor-pointer" aria-expanded={expanded}>
          <div className="flex items-start gap-2">
            <ChevronDown
              className={`w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5 transition-transform duration-200 ${
                expanded ? "rotate-180" : ""
              }`}
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{entry.clientDisplay}</p>
              <p className="text-[10px] font-semibold text-slate-500 mt-0.5">{kindLabel}</p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-slate-500 font-sans hidden sm:block text-left cursor-pointer"
        >
          {entry.contact}
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-slate-500 font-sans hidden sm:block text-left cursor-pointer"
        >
          {formatDebtorDetail(entry, t, formatDate)}
        </button>
        <div className="flex flex-col items-end gap-1.5 col-start-2 sm:contents">
          <button
            type="button"
            onClick={onToggle}
            className="text-sm font-sans font-semibold text-right whitespace-nowrap text-rose-700 cursor-pointer"
          >
            {amountLabel}
          </button>
          <div className="flex flex-col items-end gap-1.5 sm:col-start-5">
            {canPayPersonal ? (
              <>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPayByTariff();
                  }}
                  className={btnAddCls}
                >
                  <Coins className="w-3.5 h-3.5" />
                  {t("finance.debtors.payByTariff")}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPayOutstanding();
                  }}
                  className={btnOpenCls}
                >
                  <Coins className="w-3.5 h-3.5" />
                  {t("finance.debtors.payOutstanding")}
                </button>
              </>
            ) : entry.kind === "rental" && entry.renterId ? (
              <Link
                to={`/renters/${entry.renterId}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 rounded-lg"
              >
                {t("finance.debtors.openRenter")}
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {expanded ? (
        <div className="px-3 pb-3 pt-0 ml-5 sm:ml-6">
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 p-3 rounded-lg bg-slate-50/80 border border-slate-100">
            <DebtorDetailItem label={t("finance.debtors.documentType")} value={kindLabel} />
            <DebtorDetailItem label={t("common.date")} value={serviceDate} />
            <DebtorDetailItem label={t("common.timeStart")} value={timeStart} />
            <DebtorDetailItem label={t("common.timeEnd")} value={timeEnd} />
            {entry.kind === "personal" && lessonDuration ? (
              <DebtorDetailItem
                label={t("finance.debtors.lessonDuration")}
                value={lessonDuration}
              />
            ) : null}
            <DebtorDetailItem label={t("schedule.form.location")} value={locationName} />
            {entry.kind === "personal" ? (
              <DebtorDetailItem label={t("schedule.form.teacher")} value={teacherName} />
            ) : null}
            {entry.kind !== "rental" ? (
              <DebtorDetailItem label={t("common.discipline")} value={disciplineName} />
            ) : null}
            {entry.billedAmount != null ? (
              <DebtorDetailItem
                label={t("finance.debtors.adjustBilled")}
                value={formatCurrency(entry.billedAmount)}
              />
            ) : null}
            {entry.paidAmount != null && entry.paidAmount > 0 ? (
              <DebtorDetailItem
                label={t("finance.debtors.adjustPaid")}
                value={formatCurrency(entry.paidAmount)}
              />
            ) : null}
            <DebtorDetailItem label={t("finance.debtors.outstanding")} value={amountLabel} />
            {canAdjust && entry.kind === "personal" ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <button type="button" onClick={onWriteOff} className={btnDestructiveOpenCls}>
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("finance.debtors.writeOffShort")}
                </button>
              </div>
            ) : null}
            <DebtorDetailItem label={t("finance.debtors.dueStatus")} value={agingLabel} />
            {isGroup ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <dt className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
                  {t("finance.debtors.chargePerMember")}
                </dt>
                <dd className="mt-1.5 space-y-2">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-lg border border-slate-100 bg-white px-2.5 py-2"
                    >
                      <span className="text-xs font-medium text-slate-800">{member.clientDisplay}</span>
                      <span className="text-xs font-semibold text-rose-700 tabular-nums">
                        {formatCurrency(member.amount)}
                      </span>
                      {member.contact && member.contact !== "—" ? (
                        <span className="w-full text-[11px] text-slate-500">Telegram: {member.contact}</span>
                      ) : null}
                    </div>
                  ))}
                </dd>
              </div>
            ) : (
              <>
                <DebtorDetailItem label={t("common.client")} value={entry.clientDisplay || MISSING} />
                {otherParticipants ? (
                  <DebtorDetailItem
                    label={t("finance.debtors.otherParticipants")}
                    value={otherParticipants}
                  />
                ) : null}
                <DebtorDetailItem label="Telegram" value={entry.contact || MISSING} />
              </>
            )}
            {entry.kind === "subscription" ? (
              <DebtorDetailItem
                label={t("common.details")}
                value={formatDebtorDetail(entry, t, formatDate)}
              />
            ) : entry.kind === "personal" ? (
              <DebtorDetailItem
                label={t("common.details")}
                value={formatDebtorDetail(entry, t, formatDate)}
              />
            ) : null}
            {entry.kind === "personal" ? (
              <div className="sm:col-span-2 lg:col-span-3">
                <DebtorLedgerTrace
                  lessonId={entry.personalLessonId}
                  chargeId={entry.personalLessonChargeId}
                  billedAmount={entry.billedAmount ?? entry.amount}
                  paidAmount={entry.paidAmount ?? 0}
                  outstanding={entry.amount}
                />
              </div>
            ) : null}
          </dl>
          {entry.kind === "subscription" ? (
            <p className="mt-2 text-[11px] text-slate-500 font-sans">{t("finance.debtors.subscriptionNote")}</p>
          ) : null}
          {schedulePath || canAdjust ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {schedulePath ? (
                <Link to={schedulePath} className={btnOpenCls}>
                  <CalendarDays className="w-3.5 h-3.5" />
                  {t("finance.debtors.openSchedule")}
                </Link>
              ) : null}
              {canAdjust && !isGroup ? (
                <button type="button" onClick={onAdjust} className={btnOpenCls}>
                  <Pencil className="w-3.5 h-3.5" />
                  {t("finance.debtors.adjustAmount")}
                </button>
              ) : null}
              {canAdjust && entry.kind === "personal" ? (
                <button type="button" onClick={onWriteOff} className={btnDestructiveOpenCls}>
                  <Trash2 className="w-3.5 h-3.5" />
                  {t("finance.debtors.writeOffShort")}
                </button>
              ) : null}
              {isGroup && canAdjust
                ? members.map((member) => (
                    <button
                      key={`adj-${member.id}`}
                      type="button"
                      onClick={() => onAdjustMember(member)}
                      className={btnOpenCls}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      {t("finance.debtors.adjustMember", { name: member.clientDisplay })}
                    </button>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function FinanceDebtorsPage() {
  const { t, plural, formatDate, locale } = useI18n();
  const toast = useToast();
  const { can, isReadOnly } = usePermissions();
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const locationsQuery = useLocations();
  const disciplinesQuery = useDisciplines();
  const teamQuery = useTeamMembers();
  const [payTarget, setPayTarget] = useState<PayPersonalLessonTarget | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<DebtorEntry | null>(null);
  const [tab, setTab] = useState<DebtorTab>("all");
  const [sortKey, setSortKey] = useState<DebtorSortKey>("dateAsc");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const debtorsQuery = useFinancialDebtors();
  const allDebtors = useMemo(() => {
    const rows = debtorsQuery.data ?? [];
    return personalLessonsEnabled ? rows : rows.filter((entry) => entry.kind !== "personal");
  }, [debtorsQuery.data, personalLessonsEnabled]);

  const debtors = useMemo(() => {
    let rows = allDebtors;
    if (tab === "clients") rows = rows.filter((e) => e.kind !== "rental");
    else if (tab === "rentals") rows = rows.filter((e) => e.kind === "rental");
    const sorted = sortDebtors(rows, sortKey, locale);
    return groupPersonalLessonDebtors(sorted);
  }, [allDebtors, tab, sortKey, locale]);

  const totalDebt = useMemo(() => sumDebtorListAmounts(debtors), [debtors]);
  const rentalDebtTotal = useMemo(
    () => sumDebtorAmounts(allDebtors.filter((e) => e.kind === "rental")),
    [allDebtors]
  );

  const locationNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of locationsQuery.data ?? []) {
      map.set(loc.id, loc.name);
    }
    return map;
  }, [locationsQuery.data]);

  const disciplineNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of disciplinesQuery.data ?? []) {
      map.set(d.id, d.name);
    }
    return map;
  }, [disciplinesQuery.data]);

  const teacherNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of teamQuery.data ?? []) {
      const name = memberDisplayName(member);
      if (name) map.set(member.id, name);
    }
    return map;
  }, [teamQuery.data]);

  const todayISO = toISODateLocal(new Date());

  if (debtorsQuery.isLoading) return <LoadingState label={t("finance.debtors.loading")} />;
  if (debtorsQuery.isError) return <QueryErrorState error={debtorsQuery.error} />;

  const openPersonalPayment = (item: DebtorListItem, mode: "tariff" | "outstanding") => {
    const entry = item.entry;
    if (!entry.personalLessonId || !entry.lessonDate) return;
    setPayTarget({
      lessonId: entry.personalLessonId,
      date: entry.lessonDate,
      timeStart: entry.lessonTimeStart ?? "",
      timeEnd: entry.lessonTimeEnd ?? "",
      clientId1: entry.clientId1 ?? "",
      clientId2: entry.clientId2 ?? "",
      clientId3: entry.clientId3 ?? "",
      clientId4: entry.clientId4 ?? "",
      clientDisplay: entry.clientDisplay,
      payerClientId: item.members.length === 1 ? entry.payerClientId : null,
      priceId: entry.priceId,
      chargeId: item.members.length === 1 ? entry.personalLessonChargeId : null,
      price: entry.billedAmount ?? entry.amount,
      paidAmount: entry.paidAmount ?? 0,
      locationId: entry.locationId ?? null,
      disciplineId: entry.disciplineId ?? null,
      teacherMemberId: entry.teacherMemberId ?? null,
      paymentMode: mode,
      hidePackage: true,
    });
  };

  const agingLabelFor = (entry: DebtorEntry): string => {
    const days = debtorAgingDays(entry.lessonDate, todayISO);
    if (days == null) return t("finance.debtors.aging.none");
    if (days === 0) return t("finance.debtors.aging.dueToday");
    const count = Math.abs(days);
    const unit = plural(count, [t("common.day.one"), t("common.day.few"), t("common.day.many")]);
    if (days > 0) return t("finance.debtors.aging.overdue", { count, unit });
    return t("finance.debtors.aging.upcoming", { count, unit });
  };

  const tabs: { id: DebtorTab; label: string }[] = [
    { id: "all", label: t("finance.debtors.tab.all") },
    { id: "clients", label: t("finance.debtors.tab.clients") },
    { id: "rentals", label: t("finance.debtors.tab.rentals") },
  ];

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("finance.debtors.title")}</h2>
          </div>
          <span className="text-sm font-sans font-semibold text-rose-700">
            {t("finance.debtors.toPay", { amount: formatCurrency(totalDebt) })}
          </span>
        </div>
        <p className="px-4 py-2 text-[11px] leading-snug text-slate-500 border-b border-slate-100">
          {t("finance.debtors.scopeHint")}
        </p>

        <div className="px-3 py-2 border-b border-slate-100 flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                  tab === item.id
                    ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                    : "text-slate-600 hover:bg-slate-50 border border-transparent"
                }`}
              >
                {item.label}
                {item.id === "rentals" && rentalDebtTotal > 0 ? (
                  <span className="ml-1 text-rose-600">({formatCurrency(rentalDebtTotal)})</span>
                ) : null}
              </button>
            ))}
          </div>
          <div className="w-full sm:w-auto sm:min-w-[15rem]">
            <AppSelect
              label={t("finance.debtors.sort.label")}
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as DebtorSortKey)}
            >
              {DEBTOR_SORT_OPTIONS.map((key) => (
                <option key={key} value={key}>
                  {t(`finance.debtors.sort.${key}`)}
                </option>
              ))}
            </AppSelect>
          </div>
        </div>

        {debtors.length === 0 ? (
          <div className="py-20 text-center">
            <AlertCircle className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">{t("finance.debtors.empty")}</p>
          </div>
        ) : (
          <>
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
              <span>{t("common.client")}</span>
              <span>Telegram</span>
              <span>{t("common.details")}</span>
              <span className="text-right">{t("common.amount")}</span>
              <span className="text-right">{t("clients.table.actions")}</span>
            </div>
            <div>
              {debtors.map((item) => {
                const entry = item.entry;
                const canPayPersonal =
                  entry.kind === "personal" &&
                  !!entry.personalLessonId &&
                  !!(entry.payerClientId ?? entry.clientId1 ?? item.members.length > 1) &&
                  !isReadOnly &&
                  can("payments.write", {
                    disciplineId: entry.disciplineId ?? null,
                    locationId: entry.locationId ?? null,
                  });
                const canAdjust =
                  !isReadOnly &&
                  can("finance.read") &&
                  ((entry.kind === "personal" && !!entry.personalLessonId) ||
                    (entry.kind === "rental" && !!entry.rentalId));

                return (
                  <DebtorRow
                    key={item.id}
                    item={item}
                    expanded={expandedId === item.id}
                    onToggle={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                    kindLabel={debtorKindLabel(entry.kind, t)}
                    locationName={entry.locationId ? locationNameById.get(entry.locationId) ?? MISSING : MISSING}
                    disciplineName={
                      entry.disciplineId ? disciplineNameById.get(entry.disciplineId) ?? MISSING : MISSING
                    }
                    teacherName={
                      entry.teacherMemberId ? teacherNameById.get(entry.teacherMemberId) ?? MISSING : MISSING
                    }
                    agingLabel={agingLabelFor(entry)}
                    schedulePath={debtorSchedulePath(entry)}
                    canPayPersonal={canPayPersonal}
                    canAdjust={canAdjust}
                    onPayByTariff={() => openPersonalPayment(item, "tariff")}
                    onPayOutstanding={() => openPersonalPayment(item, "outstanding")}
                    onAdjust={() => setAdjustTarget(entry)}
                    onAdjustMember={(member) => setAdjustTarget(member)}
                    onWriteOff={() => setAdjustTarget(entry)}
                    formatDate={formatDate}
                    t={t}
                  />
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center bg-slate-50/60">
              <span className="text-xs text-slate-500 font-sans">
                {plural(debtors.length, [
                  t("common.records.one", { count: debtors.length }),
                  t("common.records.few", { count: debtors.length }),
                  t("common.records.many", { count: debtors.length }),
                ])}
              </span>
            </div>
          </>
        )}
      </div>
      <PayPersonalLessonModal
        lesson={payTarget}
        toast={toast}
        onClose={() => setPayTarget(null)}
        onSuccess={() => setPayTarget(null)}
      />
      <AdjustDebtorAmountDialog
        entry={adjustTarget}
        toast={toast}
        onClose={() => setAdjustTarget(null)}
        onSuccess={() => setAdjustTarget(null)}
      />
    </div>
  );
}
