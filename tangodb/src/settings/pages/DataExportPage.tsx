import { useMemo, useState } from "react";
import { Download, ChevronLeft, ChevronRight } from "lucide-react";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import CsvExportModal from "../../components/ui/CsvExportModal";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useClientDirectory } from "../../hooks/useClients";
import { useSubscriptions } from "../../hooks/useSubscriptions";
import { usePersonalLessons } from "../../hooks/usePersonalLessons";
import { useAttendanceRecords } from "../../hooks/useAttendance";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useSettings } from "../SettingsProvider";
import { exportAllDashboardCsv } from "../../lib/exportDashboardCsv";
import { currentYearMonth, formatMonthTitleRu } from "../../lib/utils";

function shiftMonth(yearMonth: string, delta: number): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const date = new Date(y, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export default function DataExportPage() {
  const toast = useToast();
  const { orgLoading, organizationId } = useOrganization();
  const { settings } = useSettings();
  const [statsMonth, setStatsMonth] = useState(currentYearMonth());
  const [exporting, setExporting] = useState(false);
  const [manualExport, setManualExport] = useState<{ filename: string; content: string } | null>(null);

  const clientsQuery = useClientDirectory();
  const subscriptionsQuery = useSubscriptions();
  const personalLessonsQuery = usePersonalLessons();
  const attendanceQuery = useAttendanceRecords();

  const isLoading =
    clientsQuery.isLoading ||
    subscriptionsQuery.isLoading ||
    personalLessonsQuery.isLoading ||
    attendanceQuery.isLoading;
  const isError =
    clientsQuery.isError ||
    subscriptionsQuery.isError ||
    personalLessonsQuery.isError ||
    attendanceQuery.isError;
  const error =
    clientsQuery.error ??
    subscriptionsQuery.error ??
    personalLessonsQuery.error ??
    attendanceQuery.error;

  const isViewingCurrentMonth = statsMonth === currentYearMonth();

  const exportSets = useMemo(
    () => [
      { id: "clients", label: "Клиенты (активные)" },
      { id: "archive", label: "Архив клиентов" },
      { id: "subscriptions", label: "Абонементы" },
      { id: "attendance", label: `Посещаемость (${formatMonthTitleRu(statsMonth)})` },
      { id: "personal", label: `Персональные (${formatMonthTitleRu(statsMonth)})` },
      { id: "prices", label: "Тарифы" },
    ],
    [statsMonth]
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
      });
      if (result.exported === 0) {
        toast("Нечего экспортировать", "error");
      } else if (result.manualSave) {
        setManualExport(result.manualSave);
        toast("Нажмите кнопку в окне ниже", "info");
      } else if (result.method === "share") {
        toast("Выберите «Сохранить в Файлы» или другое приложение", "success");
      } else {
        toast(`Скачано файлов: ${result.exported}`, "success");
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        toast("Экспорт отменён", "info");
      } else {
        toast("Не удалось экспортировать данные", "error");
      }
    } finally {
      setExporting(false);
    }
  };

  if (orgLoading || !organizationId) return <LoadingState label="Загрузка..." />;
  if (isLoading) return <LoadingState label="Загрузка данных..." />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Экспорт данных</h2>
        <p className="text-xs text-slate-500 mt-1">
          CSV-выгрузка для бухгалтерии и резервного копирования. Язык заголовков: {settings?.locale ?? "ru-RU"}.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
        <div>
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold mb-2">
            Наборы данных
          </p>
          <ul className="space-y-1.5">
            {exportSets.map((set) => (
              <li key={set.id} className="text-sm text-slate-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                {set.label}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
            Месяц для посещаемости и персональных
          </p>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonth(m, -1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 cursor-pointer"
              aria-label="Предыдущий месяц"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-slate-800 min-w-[120px] text-center">
              {formatMonthTitleRu(statsMonth)}
            </span>
            <button
              type="button"
              onClick={() => setStatsMonth((m) => shiftMonth(m, 1))}
              className="p-1 rounded-lg hover:bg-slate-50 text-slate-500 cursor-pointer"
              aria-label="Следующий месяц"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {!isViewingCurrentMonth && (
          <button
            type="button"
            onClick={() => setStatsMonth(currentYearMonth())}
            className="text-[10px] font-semibold text-indigo-600 hover:underline cursor-pointer"
          >
            Текущий месяц
          </button>
        )}

        <RequirePermission action="dashboard.export">
          <button
            type="button"
            onClick={handleExportAll}
            disabled={exporting}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            {exporting ? "Экспорт..." : "Экспорт всего"}
          </button>
        </RequirePermission>
      </div>

      <CsvExportModal
        open={manualExport != null}
        filename={manualExport?.filename ?? ""}
        content={manualExport?.content ?? ""}
        onClose={() => setManualExport(null)}
        onStatus={toast}
      />
    </div>
  );
}
