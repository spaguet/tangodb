import type { AttendanceRecord, Client, PersonalLesson, Subscription } from "../types";
import { formatClientName } from "./utils";
import { exportCsvItems } from "./exportCsv";
import type { CsvExportMethod, CsvManualSave } from "./exportCsv";
import { getCsvExportLabels } from "./exportCsvI18n";

function todayDateStr(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

function lessonYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7);
}

function clientNameFromMap(clientMap: Record<string, Client>, clientId: string): string {
  const id = clientId.trim();
  if (!id) return "";
  const client = clientMap[id];
  if (client) return formatClientName(client.lastName, client.firstName);
  if (/[^\d]/.test(id)) return id;
  return id;
}

function renderPersonalLessonClients(
  lesson: PersonalLesson,
  clientMap: Record<string, Client>,
  clientNotSpecified: string
): string {
  if (lesson.clientDisplay && lesson.clientDisplay !== clientNotSpecified) {
    return lesson.clientDisplay;
  }

  const names = [
    clientNameFromMap(clientMap, lesson.clientId1),
    lesson.clientId2 ? clientNameFromMap(clientMap, lesson.clientId2) : "",
    lesson.clientId3 ? clientNameFromMap(clientMap, lesson.clientId3) : "",
  ].filter(Boolean);

  return names.length ? names.join(" & ") : clientNotSpecified;
}

export interface DashboardExportParams {
  clients: Client[];
  subscriptions: Subscription[];
  personalLessons: PersonalLesson[];
  attendanceRecords: AttendanceRecord[];
  statsMonth: string;
  locale?: string | null;
}

export interface DashboardExportResult {
  exported: number;
  skipped: string[];
  method?: CsvExportMethod;
  manualSave?: CsvManualSave;
}

/** Export all CRM datasets as separate CSV files (sequential downloads). */
export async function exportAllDashboardCsv(params: DashboardExportParams): Promise<DashboardExportResult> {
  const dateStr = todayDateStr();
  const { statsMonth, locale } = params;
  const labels = getCsvExportLabels(locale);
  const skipped: string[] = [];

  const clientMap = Object.fromEntries(params.clients.map((c) => [c.id, c])) as Record<string, Client>;
  const activeClients = params.clients.filter((c) => !c.archivedAt);
  const archivedClients = params.clients.filter((c) => c.archivedAt);
  const activeSubscriptions = params.subscriptions.filter((s) => s.status === "active");
  const monthPersonalLessons = params.personalLessons
    .filter((l) => lessonYearMonth(l.date) === statsMonth)
    .sort((a, b) => b.date.localeCompare(a.date) || b.timeStart.localeCompare(a.timeStart));

  const exports: Array<{ rows: Record<string, string | number | null | undefined>[]; filename: string; labels: Record<string, string> }> = [];

  if (activeClients.length > 0) {
    exports.push({
      rows: activeClients.map((c) => ({
        id: c.id,
        lastName: c.lastName,
        firstName: c.firstName,
        telegram: c.telegram,
        createdAt: c.createdAt ?? "",
      })),
      filename: `clients_${dateStr}.csv`,
      labels: labels.clientsActive,
    });
  } else {
    skipped.push(labels.skipClients);
  }

  if (archivedClients.length > 0) {
    exports.push({
      rows: archivedClients.map((c) => ({
        id: c.id,
        lastName: c.lastName,
        firstName: c.firstName,
        telegram: c.telegram,
        archivedAt: c.archivedAt ? labels.formatDateTime(c.archivedAt) : "",
      })),
      filename: `clients_archive_${dateStr}.csv`,
      labels: labels.clientsArchive,
    });
  }

  if (activeSubscriptions.length > 0) {
    exports.push({
      rows: activeSubscriptions.map((sub) => ({
        id: sub.id,
        type: sub.type,
        client1: clientNameFromMap(clientMap, sub.clientId1),
        client2: sub.clientId2 ? clientNameFromMap(clientMap, sub.clientId2) : "",
        client3: sub.clientId3 ? clientNameFromMap(clientMap, sub.clientId3) : "",
        lessonsLeft: sub.lessonsLeft,
        status: sub.status === "active" ? labels.subscriptionActive : labels.subscriptionFinished,
        activationDate: sub.activationDate ?? "",
      })),
      filename: `subscriptions_${dateStr}.csv`,
      labels: labels.subscriptions,
    });
  } else {
    skipped.push(labels.skipSubscriptions);
  }

  if (params.attendanceRecords.length > 0) {
    const monthAttendance = params.attendanceRecords.filter((record) =>
      record.date.startsWith(statsMonth)
    );
    if (monthAttendance.length > 0) {
      exports.push({
        rows: monthAttendance.map((record) => ({
          date: record.date,
          subscriptionId: record.subscriptionId,
          clientDisplay: record.clientDisplay,
          status: labels.attendanceStatus(record.attendanceStatus),
        })),
        filename: `attendance_${statsMonth}.csv`,
        labels: labels.attendance,
      });
    } else {
      skipped.push(labels.skipAttendance(statsMonth));
    }
  } else {
    skipped.push(labels.skipAttendance(statsMonth));
  }

  if (monthPersonalLessons.length > 0) {
    exports.push({
      rows: monthPersonalLessons.map((l) => ({
        date: l.date,
        time: `${l.timeStart} – ${l.timeEnd}`,
        clients: renderPersonalLessonClients(l, clientMap, labels.clientNotSpecified),
        paid: l.paid === "yes" ? labels.yes : labels.no,
        price: l.price,
      })),
      filename: `personal_lessons_${statsMonth}.csv`,
      labels: labels.personalLessons,
    });
  } else {
    skipped.push(labels.skipPersonal(statsMonth));
  }

  if (exports.length === 0) {
    return { exported: 0, skipped };
  }

  const { count, method, manualSave } = await exportCsvItems(
    exports.map((item) => ({
      rows: item.rows,
      filename: item.filename,
      columnLabels: item.labels,
    })),
    `tangodb_${dateStr}.csv`
  );

  return { exported: count, skipped, method, manualSave };
}
