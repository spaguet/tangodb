import type { PaymentWithCorrectionMeta } from "./paymentCorrection";
import type { Payment } from "../types";
import { formatLessonDuration, type LessonDurationTranslate } from "./personalTariffPricing";

/** Row key for payments without tariff snapshot (§5.3 S19). */
export const PERSONAL_TARIFF_SALES_NO_TARIFF_KEY = "__no_tariff__";

export type PersonalTariffSalesPayment = Pick<
  Payment,
  | "personalLessonId"
  | "priceId"
  | "tariffLabel"
  | "tariffPrice"
  | "tariffDurationMinutes"
  | "amount"
> &
  Pick<PaymentWithCorrectionMeta, "operationKind">;

export interface PersonalTariffSalesRow {
  rowKey: string;
  priceId: string | null;
  tariffLabel: string | null;
  tariffPrice: number | null;
  tariffDurationMinutes: number | null;
  countPaymentsNet: number;
  sumNet: number;
}

/** Group key: price_id ?? snapshot (label+price+duration) ?? no-tariff bucket. */
export function personalTariffSalesRowKey(
  payment: Pick<Payment, "priceId" | "tariffLabel" | "tariffPrice" | "tariffDurationMinutes">
): string {
  if (payment.priceId) return `pid:${payment.priceId}`;
  const label = payment.tariffLabel?.trim() ?? "";
  const hasSnapshot =
    label.length > 0 || payment.tariffPrice != null || payment.tariffDurationMinutes != null;
  if (hasSnapshot) {
    return `snap:${label}|${payment.tariffPrice ?? ""}|${payment.tariffDurationMinutes ?? ""}`;
  }
  return PERSONAL_TARIFF_SALES_NO_TARIFF_KEY;
}

function personalTariffPaymentNetAmount(payment: PersonalTariffSalesPayment): number {
  return payment.operationKind === "storno" ? -payment.amount : payment.amount;
}

function personalTariffPaymentNetCount(payment: PersonalTariffSalesPayment): number {
  return payment.operationKind === "storno" ? -1 : 1;
}

/** Personal lesson payments net by tariff row (§5.3 S19). Does not sum tariff_units. */
export function aggregatePersonalTariffSales(
  payments: PersonalTariffSalesPayment[]
): PersonalTariffSalesRow[] {
  const buckets = new Map<string, PersonalTariffSalesRow>();

  for (const payment of payments) {
    if (!payment.personalLessonId) continue;
    const netAmount = personalTariffPaymentNetAmount(payment);
    if (netAmount === 0) continue;
    const rowKey = personalTariffSalesRowKey(payment);
    let row = buckets.get(rowKey);
    if (!row) {
      row = {
        rowKey,
        priceId: payment.priceId ?? null,
        tariffLabel: payment.tariffLabel?.trim() || null,
        tariffPrice: payment.tariffPrice ?? null,
        tariffDurationMinutes: payment.tariffDurationMinutes ?? null,
        countPaymentsNet: 0,
        sumNet: 0,
      };
      buckets.set(rowKey, row);
    }
    row.countPaymentsNet += personalTariffPaymentNetCount(payment);
    row.sumNet += netAmount;
  }

  const rows = [...buckets.values()].filter(
    (row) => row.countPaymentsNet !== 0 || row.sumNet !== 0
  );

  rows.sort((a, b) => {
    const aNoTariff = a.rowKey === PERSONAL_TARIFF_SALES_NO_TARIFF_KEY;
    const bNoTariff = b.rowKey === PERSONAL_TARIFF_SALES_NO_TARIFF_KEY;
    if (aNoTariff !== bNoTariff) return aNoTariff ? 1 : -1;
    return b.sumNet - a.sumNet;
  });

  return rows;
}

export function formatPersonalTariffSalesRowLabel(
  row: Pick<PersonalTariffSalesRow, "rowKey" | "tariffLabel" | "tariffDurationMinutes">,
  translate: LessonDurationTranslate
): string {
  if (row.rowKey === PERSONAL_TARIFF_SALES_NO_TARIFF_KEY) {
    return translate("personalTariff.journal.noTariff");
  }
  const label = row.tariffLabel?.trim() || translate("personalTariff.journal.tariffFallback");
  if (row.tariffDurationMinutes != null && row.tariffDurationMinutes > 0) {
    const duration = formatLessonDuration(row.tariffDurationMinutes, translate);
    return translate("finance.revenue.personalTariffs.rowWithDuration", { label, duration });
  }
  return label;
}
