import type { ConductedLessonReportRow } from "../types";
import { buildCsvContent, exportCsvItems } from "./exportCsv";
import type { CsvExportMethod, CsvManualSave } from "./exportCsv";
import { conductedLessonsReportFilename } from "./conductedLessonsReport";
import { getCsvExportLabels } from "./exportCsvI18n";
import { t } from "./i18n";
import { dowFullEntries } from "./utils";

function dayOfWeekLabel(dayOfWeek: number, locale?: string | null): string {
  const entry = dowFullEntries(locale).find(([value]) => value === dayOfWeek);
  return entry?.[1] ?? String(dayOfWeek);
}

export interface ExportConductedLessonsParams {
  rows: ConductedLessonReportRow[];
  dateFrom: string;
  dateTo: string;
  locale?: string | null;
}

export interface ExportConductedLessonsResult {
  exported: number;
  method?: CsvExportMethod;
  manualSave?: CsvManualSave;
}

export async function exportConductedLessonsCsv(
  params: ExportConductedLessonsParams
): Promise<ExportConductedLessonsResult> {
  const { rows, dateFrom, dateTo, locale } = params;
  if (rows.length === 0) {
    return { exported: 0 };
  }

  const labels = getCsvExportLabels(locale);
  const columnLabels = {
    date: t(locale, "settings.export.conductedLessons.column.date"),
    dayOfWeek: t(locale, "settings.export.conductedLessons.column.dayOfWeek"),
    timeStart: t(locale, "settings.export.conductedLessons.column.timeStart"),
    timeEnd: t(locale, "settings.export.conductedLessons.column.timeEnd"),
    disciplineCategory: t(locale, "settings.export.conductedLessons.column.category"),
    disciplineName: t(locale, "settings.export.conductedLessons.column.discipline"),
    groupName: t(locale, "settings.export.conductedLessons.column.group"),
    teacherName: t(locale, "settings.export.conductedLessons.column.teacher"),
    locationName: t(locale, "settings.export.conductedLessons.column.location"),
    presentCount: t(locale, "settings.export.conductedLessons.column.present"),
    absentCount: t(locale, "settings.export.conductedLessons.column.absent"),
    freezeCount: t(locale, "settings.export.conductedLessons.column.freeze"),
    occurrenceId: t(locale, "settings.export.conductedLessons.column.occurrenceId"),
  };

  const csvRows = rows.map((row) => ({
    date: labels.formatDate(row.date),
    dayOfWeek: dayOfWeekLabel(row.dayOfWeek, locale),
    timeStart: row.timeStart,
    timeEnd: row.timeEnd,
    disciplineCategory: row.disciplineCategory,
    disciplineName: row.disciplineName,
    groupName: row.groupName,
    teacherName: row.teacherName || "—",
    locationName: row.locationName,
    presentCount: row.presentCount,
    absentCount: row.absentCount,
    freezeCount: row.freezeCount,
    occurrenceId: row.occurrenceId,
  }));

  const filename = conductedLessonsReportFilename(dateFrom, dateTo);
  const { count, method, manualSave } = await exportCsvItems(
    [{ rows: csvRows, filename, columnLabels }],
    filename
  );

  return { exported: count, method, manualSave };
}

export function buildConductedLessonsPreviewCsv(params: ExportConductedLessonsParams): string {
  const { rows, locale } = params;
  const columnLabels = {
    date: t(locale, "settings.export.conductedLessons.column.date"),
    dayOfWeek: t(locale, "settings.export.conductedLessons.column.dayOfWeek"),
    timeStart: t(locale, "settings.export.conductedLessons.column.timeStart"),
    timeEnd: t(locale, "settings.export.conductedLessons.column.timeEnd"),
    disciplineCategory: t(locale, "settings.export.conductedLessons.column.category"),
    disciplineName: t(locale, "settings.export.conductedLessons.column.discipline"),
    groupName: t(locale, "settings.export.conductedLessons.column.group"),
    teacherName: t(locale, "settings.export.conductedLessons.column.teacher"),
    locationName: t(locale, "settings.export.conductedLessons.column.location"),
    presentCount: t(locale, "settings.export.conductedLessons.column.present"),
    absentCount: t(locale, "settings.export.conductedLessons.column.absent"),
    freezeCount: t(locale, "settings.export.conductedLessons.column.freeze"),
    occurrenceId: t(locale, "settings.export.conductedLessons.column.occurrenceId"),
  };

  const csvRows = rows.map((row) => ({
    date: row.date,
    dayOfWeek: dayOfWeekLabel(row.dayOfWeek, locale),
    timeStart: row.timeStart,
    timeEnd: row.timeEnd,
    disciplineCategory: row.disciplineCategory,
    disciplineName: row.disciplineName,
    groupName: row.groupName,
    teacherName: row.teacherName || "—",
    locationName: row.locationName,
    presentCount: row.presentCount,
    absentCount: row.absentCount,
    freezeCount: row.freezeCount,
    occurrenceId: row.occurrenceId,
  }));

  return buildCsvContent(csvRows, columnLabels);
}
