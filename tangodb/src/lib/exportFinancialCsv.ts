import type { Payment } from "../types";
import type { DebtorEntry } from "./financeReports";
import { exportCsvItems } from "./exportCsv";
import type { CsvExportMethod, CsvManualSave } from "./exportCsv";
import { getCsvExportLabels } from "./exportCsvI18n";

function paymentSourceLabel(
  payment: Payment,
  labels: ReturnType<typeof getCsvExportLabels>
): string {
  if (payment.subscriptionId) return labels.paymentSourceSubscription;
  if (payment.personalLessonId) return labels.paymentSourcePersonal;
  return "—";
}

function todayDateStr(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export interface FinancialExportParams {
  payments: Payment[];
  debtors: DebtorEntry[];
  statsMonth: string;
  locale?: string | null;
}

export interface FinancialExportResult {
  exported: number;
  skipped: string[];
  method?: CsvExportMethod;
  manualSave?: CsvManualSave;
}

export async function exportAllFinancialCsv(params: FinancialExportParams): Promise<FinancialExportResult> {
  const dateStr = todayDateStr();
  const { statsMonth, locale } = params;
  const labels = getCsvExportLabels(locale);
  const skipped: string[] = [];
  const items = [];

  const paymentRows = params.payments.map((p) => ({
    client: p.clientDisplay || "—",
    date: labels.formatDateTime(p.createdAt),
    source: paymentSourceLabel(p, labels),
    method: labels.paymentMethod(p.method),
    amount: p.amount,
  }));

  if (paymentRows.length > 0) {
    items.push({
      rows: paymentRows,
      filename: `tangodb_payments_${statsMonth}_${dateStr}.csv`,
      columnLabels: labels.payments,
    });
  } else {
    skipped.push(labels.skipPayments);
  }

  const debtorRows = params.debtors.map((d) => ({
    client: d.clientDisplay,
    contact: d.contact,
    kind: d.kind === "subscription" ? labels.debtorKindSubscription : labels.debtorKindPersonal,
    detail: d.detail,
    amount: d.amount,
  }));

  if (debtorRows.length > 0) {
    items.push({
      rows: debtorRows,
      filename: `tangodb_debtors_${dateStr}.csv`,
      columnLabels: labels.debtors,
    });
  } else {
    skipped.push(labels.skipDebtors);
  }

  if (items.length === 0) {
    return { exported: 0, skipped };
  }

  const { count, method, manualSave } = await exportCsvItems(items);
  return { exported: count, skipped, method, manualSave };
}
