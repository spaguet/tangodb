import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import DatePickerField from "../../components/ui/DatePickerField";
import AppSelect from "../../components/ui/AppSelect";
import CsvExportModal from "../../components/ui/CsvExportModal";
import LoadingState from "../../components/ui/LoadingState";
import QueryErrorState from "../../components/ui/QueryErrorState";
import { useToast } from "../../App";
import { useConductedLessonsReport } from "../../hooks/useConductedLessonsReport";
import { useDisciplines } from "../../hooks/useDisciplines";
import { usePermissions } from "../../hooks/usePermissions";
import { useI18n } from "../../hooks/useI18n";
import {
  currentCalendarWeekRange,
  uniqueDisciplineCategories,
} from "../../lib/conductedLessonsReport";
import { exportConductedLessonsCsv } from "../../lib/exportConductedLessonsCsv";
import { formatWeekRangeLabel, getWeekRange } from "../../lib/scheduleWeek";
import type { Discipline } from "../../types";

const PREVIEW_ROW_LIMIT = 8;

function ConductedLessonsDisciplinePicker({
  disciplines,
  selectedIds,
  onChange,
}: {
  disciplines: Discipline[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useI18n();
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      onChange(selectedIds.filter((item) => item !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  };

  const selectAll = () => onChange(disciplines.map((d) => d.id));
  const clearAll = () => onChange([]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
          {t("settings.export.conductedLessons.disciplines")}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="text-[10px] font-semibold text-indigo-600 hover:underline cursor-pointer"
          >
            {t("settings.export.conductedLessons.selectAll")}
          </button>
          <button
            type="button"
            onClick={clearAll}
            className="text-[10px] font-semibold text-slate-500 hover:underline cursor-pointer"
          >
            {t("settings.export.conductedLessons.clearAll")}
          </button>
        </div>
      </div>
      <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
        {disciplines.map((discipline) => (
          <label
            key={discipline.id}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={selectedSet.has(discipline.id)}
              onChange={() => toggle(discipline.id)}
              className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="truncate">{discipline.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export default function ConductedLessonsReportSection() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const { can } = usePermissions();
  const { data: disciplines = [], isLoading, isError, error } = useDisciplines();

  const defaultRange = useMemo(() => currentCalendarWeekRange(), []);
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom);
  const [dateTo, setDateTo] = useState(defaultRange.dateTo);
  const [category, setCategory] = useState<string>("");
  const [selectedDisciplineIds, setSelectedDisciplineIds] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [manualExport, setManualExport] = useState<{ filename: string; content: string } | null>(null);

  const categories = useMemo(() => uniqueDisciplineCategories(disciplines), [disciplines]);

  const categoryDisciplines = useMemo(() => {
    if (!category) return disciplines;
    return disciplines.filter(
      (d) => (d.category?.trim().toLowerCase() ?? "") === category.trim().toLowerCase()
    );
  }, [disciplines, category]);

  useEffect(() => {
    if (categoryDisciplines.length === 0) {
      setSelectedDisciplineIds([]);
      return;
    }
    setSelectedDisciplineIds(categoryDisciplines.map((d) => d.id));
  }, [category, categoryDisciplines]);

  const reportQuery = useConductedLessonsReport({
    dateFrom,
    dateTo,
    disciplineIds: selectedDisciplineIds,
    enabled: selectedDisciplineIds.length > 0,
  });

  const rows = reportQuery.data?.rows ?? [];
  const includedDisciplines = disciplines.filter((d) => selectedDisciplineIds.includes(d.id));
  const excludedDisciplines = categoryDisciplines.filter((d) => !selectedDisciplineIds.includes(d.id));

  const periodLabel = useMemo(() => {
    const { weekStart, weekEnd } = getWeekRange(new Date(`${dateFrom}T12:00:00`));
    if (dateFrom === defaultRange.dateFrom && dateTo === defaultRange.dateTo) {
      return formatWeekRangeLabel(weekStart, weekEnd, locale);
    }
    return `${dateFrom} — ${dateTo}`;
  }, [dateFrom, dateTo, defaultRange.dateFrom, defaultRange.dateTo, locale]);

  const handleExport = async () => {
    if (exporting || rows.length === 0) return;
    setExporting(true);
    try {
      const result = await exportConductedLessonsCsv({
        rows,
        dateFrom,
        dateTo,
        locale,
      });
      if (result.exported === 0) {
        toast(t("settings.export.conductedLessons.emptyExport"), "error");
      } else if (result.manualSave) {
        setManualExport(result.manualSave);
        toast(t("common.exportHintClick"), "info");
      } else if (result.method === "share") {
        toast(t("common.exportHintSave"), "success");
      } else {
        toast(t("common.exportedFiles", { count: result.exported }), "success");
      }
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

  if (isLoading) return <LoadingState label={t("settings.export.conductedLessons.loading")} />;
  if (isError) return <QueryErrorState error={error} />;

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
        <div>
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold mb-1">
            {t("settings.export.conductedLessons.title")}
          </p>
          <p className="text-xs text-slate-500">{t("settings.export.conductedLessons.subtitle")}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DatePickerField
            label={t("settings.export.conductedLessons.dateFrom")}
            value={dateFrom}
            onChange={setDateFrom}
            max={dateTo}
            required
          />
          <DatePickerField
            label={t("settings.export.conductedLessons.dateTo")}
            value={dateTo}
            onChange={setDateTo}
            min={dateFrom}
            required
          />
        </div>

        {categories.length > 0 && (
          <AppSelect
            label={t("settings.export.conductedLessons.category")}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">{t("settings.export.conductedLessons.allCategories")}</option>
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </AppSelect>
        )}

        {categoryDisciplines.length > 0 ? (
          <ConductedLessonsDisciplinePicker
            disciplines={categoryDisciplines}
            selectedIds={selectedDisciplineIds}
            onChange={setSelectedDisciplineIds}
          />
        ) : (
          <p className="text-sm text-slate-500">{t("settings.export.conductedLessons.noDisciplinesInCategory")}</p>
        )}

        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3 space-y-2 text-xs text-slate-600">
          <p>
            <span className="font-semibold text-slate-700">{t("settings.export.conductedLessons.previewPeriod")}:</span>{" "}
            {periodLabel}
          </p>
          {category && (
            <p>
              <span className="font-semibold text-slate-700">{t("settings.export.conductedLessons.previewCategory")}:</span>{" "}
              {category}
            </p>
          )}
          <p>
            <span className="font-semibold text-slate-700">{t("settings.export.conductedLessons.previewIncluded")}:</span>{" "}
            {includedDisciplines.length > 0
              ? includedDisciplines.map((d) => d.name).join(", ")
              : t("settings.export.conductedLessons.noneSelected")}
          </p>
          {excludedDisciplines.length > 0 && (
            <p>
              <span className="font-semibold text-slate-700">{t("settings.export.conductedLessons.previewExcluded")}:</span>{" "}
              {excludedDisciplines.map((d) => d.name).join(", ")}
            </p>
          )}
          <p>
            <span className="font-semibold text-slate-700">{t("settings.export.conductedLessons.previewCount")}:</span>{" "}
            {reportQuery.isFetching ? "…" : rows.length}
          </p>
        </div>

        {selectedDisciplineIds.length === 0 ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            {t("settings.export.conductedLessons.selectDisciplinesHint")}
          </p>
        ) : reportQuery.isFetching ? (
          <LoadingState label={t("settings.export.conductedLessons.loadingPreview")} />
        ) : reportQuery.isError ? (
          <QueryErrorState error={reportQuery.error} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t("settings.export.conductedLessons.noData")}</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider">
                <tr>
                  <th className="px-2 py-2 text-left font-semibold">{t("settings.export.conductedLessons.column.date")}</th>
                  <th className="px-2 py-2 text-left font-semibold">{t("settings.export.conductedLessons.column.timeStart")}</th>
                  <th className="px-2 py-2 text-left font-semibold">{t("settings.export.conductedLessons.column.discipline")}</th>
                  <th className="px-2 py-2 text-left font-semibold">{t("settings.export.conductedLessons.column.group")}</th>
                  <th className="px-2 py-2 text-right font-semibold">{t("settings.export.conductedLessons.column.present")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {rows.slice(0, PREVIEW_ROW_LIMIT).map((row) => (
                  <tr key={row.occurrenceId}>
                    <td className="px-2 py-2 whitespace-nowrap">{row.date}</td>
                    <td className="px-2 py-2 whitespace-nowrap">{row.timeStart}</td>
                    <td className="px-2 py-2">{row.disciplineName}</td>
                    <td className="px-2 py-2">{row.groupName}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{row.presentCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > PREVIEW_ROW_LIMIT && (
              <p className="px-2 py-2 text-[10px] text-slate-400 border-t border-slate-100">
                {t("settings.export.conductedLessons.previewMore", { count: rows.length - PREVIEW_ROW_LIMIT })}
              </p>
            )}
          </div>
        )}

        {can("dashboard.export") && (
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting || rows.length === 0 || selectedDisciplineIds.length === 0}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Download className="w-4 h-4" />
            {exporting ? t("common.exporting") : t("settings.export.conductedLessons.exportButton")}
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
