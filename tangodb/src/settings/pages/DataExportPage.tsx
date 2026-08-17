import { useMemo, useState } from "react";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import CsvExportModal from "../../components/ui/CsvExportModal";
import { btnAddCls } from "../../components/ui/buttonStyles";
import { useToast } from "../../App";
import { usePermissions } from "../../hooks/usePermissions";
import { useClientDirectory } from "../../hooks/useClients";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { usePersonalLessons } from "../../hooks/usePersonalLessons";
import { useAttendanceRecords } from "../../hooks/useAttendance";
import { usePayments } from "../../hooks/usePayments";
import { useExpenses } from "../../hooks/useExpenses";
import { useFinanceCosts } from "../../hooks/useVenueCosts";
import { useFinancialDebtors } from "../../hooks/useFinancialDebtors";
import { memberListLabel, useTeamMembers } from "../../hooks/useTeamMembers";
import { useRentalPayments } from "../../hooks/useRentalPayments";
import { useOrganization } from "../../organization/OrganizationProvider";
import { canAccessDataExportSection, permissionOptionsFromSettings } from "../../lib/permissions";
import { normalizeOrgModules } from "../../lib/orgModules";
import { usePersonalLessonsModuleEnabled } from "../../hooks/useOrgModules";
import { useSettings } from "../SettingsProvider";
import { exportAllDashboardCsv } from "../../lib/exportDashboardCsv";
import { exportAllFinancialCsv } from "../../lib/exportFinancialCsv";
import { monthDateRange } from "../../lib/financeReports";
import { currentYearMonth, formatMonthTitle, shiftMonth } from "../../lib/utils";
import { useI18n } from "../../hooks/useI18n";
import ConductedLessonsReportSection from "../components/ConductedLessonsReportSection";

function shiftMonthLocal(yearMonth: string, delta: number): string {
  return shiftMonth(yearMonth, delta);
}

function useExportToast() {
  const toast = useToast();
  const { t } = useI18n();
  return (result: { exported: number; method?: string; manualSave?: unknown }, emptyMsg: string) => {
    if (result.exported === 0) {
      toast(emptyMsg, "error");
    } else if (result.manualSave) {
      toast(t("common.exportHintClick"), "info");
    } else if (result.method === "share") {
      toast(t("common.exportHintSave"), "success");
    } else {
      toast(t("common.exportedFiles", { count: result.exported }), "success");
    }
  };
}

function OperationalExportSection() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const showExportToast = useExportToast();
  const { can } = usePermissions();
  const personalLessonsEnabled = usePersonalLessonsModuleEnabled();
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const [exporting, setExporting] = useState(false);
  const [manualExport, setManualExport] = useState<{ filename: string; content: string } | null>(null);

  const clientsQuery = useClientDirectory();
  const subscriptionsQuery = useSubscriptions();
  const personalLessonsQuery = usePersonalLessons({ enabled: personalLessonsEnabled });
  const attendanceQuery = useAttendanceRecords();

  const isLoading =
    clientsQuery.isLoading ||
    subscriptionsQuery.isLoading ||
    (personalLessonsEnabled && personalLessonsQuery.isLoading) ||
    attendanceQuery.isLoading;
  const isError =
    clientsQuery.isError ||
    subscriptionsQuery.isError ||
    (personalLessonsEnabled && personalLessonsQuery.isError) ||
    attendanceQuery.isError;
  const error =
    clientsQuery.error ??
    subscriptionsQuery.error ??
    (personalLessonsEnabled ? personalLessonsQuery.error : null) ??
    attendanceQuery.error;

  const isViewingCurrentMonth = statsMonth === currentYearMonth();

  const exportSets = useMemo(
    () => [
      { id: "clients", label: t("settings.export.clients") },
      { id: "archive", label: t("settings.export.archive") },
      { id: "subscriptions", label: t("settings.export.subscriptions") },
      {
        id: "attendance",
        label: t("settings.export.attendance", { month: formatMonthTitle(statsMonth, locale) }),
      },
      ...(personalLessonsEnabled
        ? [
            {
              id: "personal",
              label: t("settings.export.personal", { month: formatMonthTitle(statsMonth, locale) }),
            },
          ]
        : []),
      { id: "prices", label: t("settings.export.prices") },
    ],
    [statsMonth, t, locale, personalLessonsEnabled]
  );

  const handleExportAll = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const result = await exportAllDashboardCsv({
        clients: clientsQuery.data ?? [],
        subscriptions: subscriptionsQuery.data ?? [],
        personalLessons: personalLessonsQuery.data ?? [],
        attendanceRecords: attendanceQuery.data ?? [],
        statsMonth,
        locale,
      });
      if (result.manualSave) setManualExport(result.manualSave);
      showExportToast(result, t("common.nothingToExport"));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast(t("common.exportCancelled"), "info");
      } else {
        toast(t("common.exportFailed"), "error");
      }
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) return <LoadingState label={t("settings.export.loadingOperational")} />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <>
      <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4 space-y-4">
        <div>
          <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold mb-2">
            {t("settings.export.operationalTitle")}
          </p>
          <ul className="space-y-1.5">
            {exportSets.map((set) => (
              <li key={set.id} className="text-sm text-ink-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gold-400 shrink-0" />
                {set.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-100 pt-3">
          <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold">
            {t("settings.export.operationalMonth")}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonthLocal(m, -1))}
              className="p-1 rounded-lg hover:bg-ink-50 text-ink-500 cursor-pointer"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-ink-800 min-w-[120px] text-center">
              {formatMonthTitle(statsMonth, locale)}
            </span>
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonthLocal(m, 1))}
              className="p-1 rounded-lg hover:bg-ink-50 text-ink-500 cursor-pointer"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!isViewingCurrentMonth && (
          <button
            type="button"
            onClick={() => setStatsMonth(currentYearMonth())}
            className="text-[10px] font-semibold text-gold-700 hover:underline cursor-pointer"
          >
            {t("common.currentMonth")}
          </button>
        )}

        {can("dashboard.export") && (
          <button
            type="button"
            onClick={handleExportAll}
            disabled={exporting}
            className={`w-full ${btnAddCls}`}
          >
            <Download className="w-4 h-4" />
            {exporting ? t("common.exporting") : t("settings.export.operationalButton")}
          </button>
        )}
      </div>

      <CsvExportModal
        open={manualExport != null}
        filename={manualExport?.filename ?? ""}
        content={manualExport?.content ?? ""}
        onClose={() => setManualExport(null)}
        onStatus={toast}
      />
    </>
  );
}

function FinancialExportSection() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const showExportToast = useExportToast();
  const { can } = usePermissions();
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const [exporting, setExporting] = useState(false);
  const [manualExport, setManualExport] = useState<{ filename: string; content: string } | null>(null);

  const range = monthDateRange(statsMonth);
  const paymentsQuery = usePayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  const expensesQuery = useExpenses({ dateFrom: range.dateFrom, dateTo: range.dateTo });
  const financeCostsQuery = useFinanceCosts(range.dateFrom, range.dateTo);
  const debtorsQuery = useFinancialDebtors();
  const teamQuery = useTeamMembers();
  const rentalPaymentsQuery = useRentalPayments({ dateFrom: range.dateFrom, dateTo: range.dateTo });

  const isLoading =
    paymentsQuery.isLoading ||
    expensesQuery.isLoading ||
    financeCostsQuery.isLoading ||
    debtorsQuery.isLoading ||
    rentalPaymentsQuery.isLoading;
  const isError =
    paymentsQuery.isError ||
    expensesQuery.isError ||
    financeCostsQuery.isError ||
    debtorsQuery.isError ||
    rentalPaymentsQuery.isError;
  const error =
    paymentsQuery.error ??
    expensesQuery.error ??
    financeCostsQuery.error ??
    debtorsQuery.error ??
    rentalPaymentsQuery.error;

  const isViewingCurrentMonth = statsMonth === currentYearMonth();

  const exportSets = useMemo(
    () => [
      {
        id: "payments",
        label: t("settings.export.payments", { month: formatMonthTitle(statsMonth, locale) }),
      },
      {
        id: "expenses",
        label: t("settings.export.expenses", { month: formatMonthTitle(statsMonth, locale) }),
      },
      { id: "debtors", label: t("settings.export.debtors") },
    ],
    [statsMonth, t, locale]
  );

  const handleExportAll = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const memberNameById = new Map(
        (teamQuery.data ?? []).map((member) => [member.id, memberListLabel(member, locale)])
      );
      const result = await exportAllFinancialCsv({
        payments: paymentsQuery.data ?? [],
        rentalRegisterEntries: rentalPaymentsQuery.data ?? [],
        expenses: expensesQuery.data ?? [],
        venueCostEntries: financeCostsQuery.data?.entries ?? [],
        debtors: debtorsQuery.data ?? [],
        statsMonth,
        locale,
        memberNameById,
      });
      if (result.manualSave) setManualExport(result.manualSave);
      showExportToast(result, t("common.nothingToExport"));
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast(t("common.exportCancelled"), "info");
      } else {
        toast(t("common.exportFinanceFailed"), "error");
      }
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) return <LoadingState label={t("settings.export.loadingFinance")} />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <>
      <div className="bg-white rounded-xl border border-ink-200 shadow-xs p-4 space-y-4">
        <div>
          <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold mb-2">
            {t("settings.export.financeTitle")}
          </p>
          <ul className="space-y-1.5">
            {exportSets.map((set) => (
              <li key={set.id} className="text-sm text-ink-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gold-400 shrink-0" />
                {set.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ink-100 pt-3">
          <p className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold">
            {t("settings.export.financeMonth")}
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonthLocal(m, -1))}
              className="p-1 rounded-lg hover:bg-ink-50 text-ink-500 cursor-pointer"
              aria-label={t("subscriptions.aria.prevMonth")}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-ink-800 min-w-[120px] text-center">
              {formatMonthTitle(statsMonth, locale)}
            </span>
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonthLocal(m, 1))}
              className="p-1 rounded-lg hover:bg-ink-50 text-ink-500 cursor-pointer"
              aria-label={t("subscriptions.aria.nextMonth")}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!isViewingCurrentMonth && (
          <button
            type="button"
            onClick={() => setStatsMonth(currentYearMonth())}
            className="text-[10px] font-semibold text-gold-700 hover:underline cursor-pointer"
          >
            {t("common.currentMonth")}
          </button>
        )}

        {can("finance.export") && (
          <button
            type="button"
            onClick={handleExportAll}
            disabled={exporting}
            className={`w-full ${btnAddCls}`}
          >
            <Download className="w-4 h-4" />
            {exporting ? t("common.exporting") : t("settings.export.financeButton")}
          </button>
        )}
      </div>

      <CsvExportModal
        open={manualExport != null}
        filename={manualExport?.filename ?? ""}
        content={manualExport?.content ?? ""}
        onClose={() => setManualExport(null)}
        onStatus={toast}
      />
    </>
  );
}

export default function DataExportPage() {
  const { t } = useI18n();
  const { can, role, scope, isReadOnly, membership } = usePermissions();
  const { orgLoading, organizationId, settings } = useOrganization();
  const { settings: exportSettings } = useSettings();
  const modules = normalizeOrgModules(settings?.modules);
  const permissionOptions = permissionOptionsFromSettings(settings, scope, {
    restrictedAdmin: membership?.meta?.restricted_admin ?? false,
    isReadOnly,
  });

  const canDashboardExport = can("dashboard.export");
  const canFinancialExport = can("finance.export") && modules.finance_basic;
  const canAnyExport = canAccessDataExportSection(role, modules, permissionOptions);

  if (orgLoading || !organizationId) return <LoadingState label={t("common.loading.default")} />;
  if (!canAnyExport) {
    return (
      <div className="panel-card-stack max-w-xl">
        <p className="text-sm text-ink-500">{t("settings.export.noPermission")}</p>
      </div>
    );
  }

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-ink-900">{t("settings.export.title")}</h2>
        <p className="text-xs text-ink-500 mt-1">
          {t("settings.export.subtitle")} {exportSettings?.locale ?? "ru-RU"}.
        </p>
      </div>

      {canFinancialExport && <FinancialExportSection />}
      {canDashboardExport && <OperationalExportSection />}
      {canDashboardExport && <ConductedLessonsReportSection />}
    </div>
  );
}
