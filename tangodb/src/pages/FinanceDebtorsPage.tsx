import { useMemo, useState } from "react";
import { AlertCircle, Coins } from "lucide-react";
import { Link } from "react-router-dom";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { useFinancialDebtors } from "../hooks/useFinancialDebtors";
import { useI18n } from "../hooks/useI18n";
import { usePermissions } from "../hooks/usePermissions";
import { useToast } from "../App";
import { usePersonalLessonsModuleEnabled } from "../hooks/useOrgModules";
import {
  sortDebtors,
  sumDebtorAmounts,
  formatDebtorDetail,
  type DebtorEntry,
  type DebtorSortKey,
} from "../lib/financeReports";
import { formatCurrency } from "../lib/utils";
import PayPersonalLessonModal, { type PayPersonalLessonTarget } from "../components/schedule/PayPersonalLessonModal";
import { btnAddCls } from "../components/ui/buttonStyles";
import AppSelect from "../components/ui/AppSelect";

type DebtorTab = "all" | "clients" | "rentals";

const DEBTOR_SORT_OPTIONS: DebtorSortKey[] = [
  "dateAsc",
  "dateDesc",
  "nameAsc",
  "nameDesc",
  "amountDesc",
];

function debtorKindLabel(kind: DebtorEntry["kind"], t: ReturnType<typeof useI18n>["t"]): string | null {
  if (kind === "rental") return t("finance.debtors.kind.rental");
  return null;
}

export default function FinanceDebtorsPage() {
  const { t, plural, formatDate, locale } = useI18n();
  const toast = useToast();
  const { can, isReadOnly } = usePermissions();
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const [payTarget, setPayTarget] = useState<PayPersonalLessonTarget | null>(null);
  const [tab, setTab] = useState<DebtorTab>("all");
  const [sortKey, setSortKey] = useState<DebtorSortKey>("dateAsc");

  const debtorsQuery = useFinancialDebtors();
  const allDebtors = useMemo(() => {
    const rows = debtorsQuery.data ?? [];
    return personalLessonsEnabled ? rows : rows.filter((entry) => entry.kind !== "personal");
  }, [debtorsQuery.data, personalLessonsEnabled]);

  const debtors = useMemo(() => {
    let rows = allDebtors;
    if (tab === "clients") rows = rows.filter((e) => e.kind !== "rental");
    else if (tab === "rentals") rows = rows.filter((e) => e.kind === "rental");
    return sortDebtors(rows, sortKey, locale);
  }, [allDebtors, tab, sortKey, locale]);

  const totalDebt = useMemo(() => sumDebtorAmounts(debtors), [debtors]);
  const rentalDebtTotal = useMemo(
    () => sumDebtorAmounts(allDebtors.filter((e) => e.kind === "rental")),
    [allDebtors]
  );

  if (debtorsQuery.isLoading) return <LoadingState label={t("finance.debtors.loading")} />;
  if (debtorsQuery.isError) return <QueryErrorState error={debtorsQuery.error} />;

  const openPersonalPayment = (entry: DebtorEntry) => {
    if (!entry.personalLessonId || !entry.clientId1 || !entry.lessonDate) return;
    setPayTarget({
      lessonId: entry.personalLessonId,
      date: entry.lessonDate,
      timeStart: entry.lessonTimeStart ?? "",
      timeEnd: entry.lessonTimeEnd ?? "",
      clientId1: entry.clientId1,
      clientId2: entry.clientId2 ?? "",
      clientId3: entry.clientId3 ?? "",
      clientDisplay: entry.clientDisplay,
      price: entry.amount,
      locationId: entry.locationId ?? null,
      disciplineId: entry.disciplineId ?? null,
    });
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
              {debtors.map((entry) => {
                const kindLabel = debtorKindLabel(entry.kind, t);
                const canPayPersonal =
                  entry.kind === "personal" &&
                  !!entry.personalLessonId &&
                  !!entry.clientId1 &&
                  !isReadOnly &&
                  can("payments.write", {
                    disciplineId: entry.disciplineId ?? null,
                    locationId: entry.locationId ?? null,
                  });

                return (
                  <div
                    key={entry.id}
                    className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto_auto] gap-2 sm:gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{entry.clientDisplay}</p>
                      {kindLabel ? (
                        <p className="text-[10px] font-semibold text-amber-700 mt-0.5">{kindLabel}</p>
                      ) : null}
                    </div>
                    <p className="text-xs text-slate-500 font-sans hidden sm:block">{entry.contact}</p>
                    <p className="text-xs text-slate-500 font-sans hidden sm:block">
                      {formatDebtorDetail(entry, t, formatDate)}
                    </p>
                    <p className="text-sm font-sans font-semibold text-right whitespace-nowrap text-rose-700">
                      {entry.amount > 0 ? formatCurrency(entry.amount) : "—"}
                    </p>
                    <div className="text-right">
                      {canPayPersonal ? (
                        <button
                          type="button"
                          onClick={() => openPersonalPayment(entry)}
                          className={btnAddCls}
                        >
                          <Coins className="w-3.5 h-3.5" />
                          {t("common.pay")}
                        </button>
                      ) : entry.kind === "rental" && entry.renterId ? (
                        <Link
                          to={`/renters/${entry.renterId}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-50 rounded-lg"
                        >
                          {t("finance.debtors.openRenter")}
                        </Link>
                      ) : null}
                    </div>
                  </div>
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
    </div>
  );
}
