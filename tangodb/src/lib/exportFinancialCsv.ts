import type { Payment, PaymentMethod } from "../types";
import type { DebtorEntry } from "./financeReports";
import { exportCsvItems } from "./exportCsv";
import type { CsvExportMethod, CsvManualSave } from "./exportCsv";

const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Наличные",
  transfer: "Перевод",
  card: "Карта",
  other: "Другое",
};

function paymentSourceLabel(payment: Payment): string {
  if (payment.subscriptionId) return "Абонемент";
  if (payment.personalLessonId) return "Персональный урок";
  return "—";
}

function formatPaymentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayDateStr(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export interface FinancialExportParams {
  payments: Payment[];
  debtors: DebtorEntry[];
  statsMonth: string;
}

export interface FinancialExportResult {
  exported: number;
  skipped: string[];
  method?: CsvExportMethod;
  manualSave?: CsvManualSave;
}

export async function exportAllFinancialCsv(params: FinancialExportParams): Promise<FinancialExportResult> {
  const dateStr = todayDateStr();
  const { statsMonth } = params;
  const skipped: string[] = [];
  const items = [];

  const paymentRows = params.payments.map((p) => ({
    client: p.clientDisplay || "—",
    date: formatPaymentDate(p.createdAt),
    source: paymentSourceLabel(p),
    method: PAYMENT_METHOD_LABELS[p.method],
    amount: p.amount,
  }));

  if (paymentRows.length > 0) {
    items.push({
      rows: paymentRows,
      filename: `tangodb_payments_${statsMonth}_${dateStr}.csv`,
      columnLabels: {
        client: "Клиент",
        date: "Дата",
        source: "Источник",
        method: "Способ оплаты",
        amount: "Сумма",
      },
    });
  } else {
    skipped.push("Платежи");
  }

  const debtorRows = params.debtors.map((d) => ({
    client: d.clientDisplay,
    contact: d.contact,
    kind: d.kind === "subscription" ? "Абонемент" : "Персональный",
    detail: d.detail,
    amount: d.amount,
  }));

  if (debtorRows.length > 0) {
    items.push({
      rows: debtorRows,
      filename: `tangodb_debtors_${dateStr}.csv`,
      columnLabels: {
        client: "Клиент",
        contact: "Контакт",
        kind: "Тип",
        detail: "Детали",
        amount: "Сумма долга",
      },
    });
  } else {
    skipped.push("Дебиторы");
  }

  if (items.length === 0) {
    return { exported: 0, skipped };
  }

  const { count, method, manualSave } = await exportCsvItems(items);
  return { exported: count, skipped, method, manualSave };
}
