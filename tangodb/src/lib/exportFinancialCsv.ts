import type { Payment } from "../types";
import type { RentalMoneyRegisterEntry } from "../types";
import type { Expense } from "../types/expense";
import type { FinanceCostEntry } from "../hooks/useVenueCosts";
import type { DebtorEntry } from "./financeReports";
import { exportCsvItems } from "./exportCsv";
import type { CsvExportMethod, CsvManualSave } from "./exportCsv";
import { getCsvExportLabels } from "./exportCsvI18n";
import { expenseCategoryKey } from "./expenseCategories";
import { t } from "./i18n";

function paymentSourceLabel(
  payment: Payment,
  labels: ReturnType<typeof getCsvExportLabels>
): string {
  if (payment.subscriptionId) return labels.paymentSourceSubscription;
  if (payment.personalLessonId) return labels.paymentSourcePersonal;
  if (payment.singleVisitId) return labels.paymentSourceSingleVisit;
  return "—";
}

function todayDateStr(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
}

export interface FinancialExportParams {
  payments: Payment[];
  rentalRegisterEntries?: RentalMoneyRegisterEntry[];
  /** @deprecated Use rentalRegisterEntries */
  rentalPayments?: RentalMoneyRegisterEntry[];
  expenses: Expense[];
  /** Automatic venue-cost accruals (read-only); merged into expenses CSV. */
  venueCostEntries?: FinanceCostEntry[];
  debtors: DebtorEntry[];
  statsMonth: string;
  locale?: string | null;
  memberNameById?: Map<string, string>;
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

  const rentalEntries = params.rentalRegisterEntries ?? params.rentalPayments ?? [];
  const memberNameById = params.memberNameById ?? new Map<string, string>();
  const rentalRows = rentalEntries.map((p) => ({
    renter: p.renterDisplay || "—",
    date: labels.formatDateTime(p.createdAt),
    source: t(locale, `finance.rentalRegister.type.${p.entryType}` as import("./i18n/keys").I18nKey),
    rentalDate: p.rentalDate ? labels.formatDate(p.rentalDate) : "—",
    method: labels.paymentMethod(p.method),
    acceptedBy: p.createdBy
      ? memberNameById.get(p.createdBy) ?? p.createdBy
      : "—",
    amount: p.signedAmount,
  }));

  if (rentalRows.length > 0) {
    items.push({
      rows: rentalRows,
      filename: `tangodb_rentals_${statsMonth}_${dateStr}.csv`,
      columnLabels: {
        renter: t(locale, "schedule.rental.renterLabel"),
        date: labels.payments.date,
        source: labels.payments.source,
        rentalDate: t(locale, "schedule.rental.dateLabel"),
        method: labels.payments.method,
        acceptedBy: t(locale, "finance.payments.acceptedBy"),
        amount: labels.payments.amount,
      },
    });
  }

  const manualExpenseRows = params.expenses.map((e) => ({
    date: labels.formatDate(e.expenseDate),
    category: t(locale, expenseCategoryKey(e.category)),
    description: e.description || "—",
    amount: e.amount,
    source: t(locale, "venueCosts.finance.manualTotal"),
  }));
  const venueExpenseRows = (params.venueCostEntries ?? [])
    .filter((entry) => entry.sourceType === "venue_cost")
    .map((entry) => ({
      date: labels.formatDate(entry.entryDate),
      category: t(locale, "venueCosts.finance.venueTotal"),
      description: entry.description || t(locale, "venueCosts.finance.autoRow"),
      amount: entry.amount,
      source: t(locale, "venueCosts.finance.autoRow"),
    }));
  const expenseRows = [...manualExpenseRows, ...venueExpenseRows];

  if (expenseRows.length > 0) {
    items.push({
      rows: expenseRows,
      filename: `tangodb_expenses_${statsMonth}_${dateStr}.csv`,
      columnLabels: {
        ...labels.expenses,
        source: t(locale, "csv.column.source"),
      },
    });
  } else {
    skipped.push(labels.skipExpenses);
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
