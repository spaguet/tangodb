import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { PaymentMethod, RentalMoneyEntryType, RentalMoneyRegisterEntry } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const rentalMoneyRegisterQueryKey = ["rentalMoneyRegister"] as const;

/** @deprecated Use rentalMoneyRegisterQueryKey */
export const rentalPaymentsQueryKey = rentalMoneyRegisterQueryKey;

export interface RentalMoneyRegisterFilter {
  dateFrom?: string;
  dateTo?: string;
  enabled?: boolean;
}

const mapRegisterEntry = (row: Record<string, unknown>): RentalMoneyRegisterEntry => ({
  registerKey: String(row.register_key ?? ""),
  id: String(row.entry_id ?? row.source_id ?? ""),
  entryType: String(row.entry_type ?? "direct_booking_payment") as RentalMoneyEntryType,
  sourceTable: String(row.source_table ?? ""),
  sourceId: String(row.source_id ?? ""),
  signedAmount: Number(row.signed_amount) || 0,
  amount: Number(row.amount ?? row.signed_amount) || 0,
  currency: String(row.currency ?? "RUB"),
  method: (row.method as PaymentMethod) || "other",
  methodComment: row.method_comment != null ? String(row.method_comment) : null,
  renterId: row.renter_id != null ? String(row.renter_id) : null,
  renterDisplay: row.renter_display != null ? String(row.renter_display) : undefined,
  rentalId: row.rental_id != null ? String(row.rental_id) : null,
  invoiceId: row.invoice_id != null ? String(row.invoice_id) : null,
  advanceId: row.advance_id != null ? String(row.advance_id) : null,
  depositId: row.deposit_id != null ? String(row.deposit_id) : null,
  createdBy: row.created_by != null ? String(row.created_by) : null,
  createdAt: String(row.operation_ts ?? ""),
  operationDate: String(row.operation_date ?? "").slice(0, 10),
  rentalDate: row.rental_date != null ? String(row.rental_date).slice(0, 10) : undefined,
  locationId: row.location_id != null ? String(row.location_id) : null,
  operationKind: row.operation_kind === "storno" ? "storno" : "payment",
  reversesPaymentId: row.reverses_payment_id != null ? String(row.reverses_payment_id) : null,
  replacesPaymentId: row.replaces_payment_id != null ? String(row.replaces_payment_id) : null,
  correctionReasonCode:
    row.correction_reason_code != null ? String(row.correction_reason_code) : null,
  correctionComment: row.correction_comment != null ? String(row.correction_comment) : null,
  operationNumber: row.operation_number != null ? Number(row.operation_number) : null,
});

export function useRentalMoneyRegister(filter?: RentalMoneyRegisterFilter) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (filter?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...rentalMoneyRegisterQueryKey, filter ?? {}]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_rental_money_register", {
        p_date_from: filter?.dateFrom ?? null,
        p_date_to: filter?.dateTo ?? null,
      });
      if (error) throw error;

      const payload = data as { success?: boolean; error_code?: string; entries?: Record<string, unknown>[] };
      if (!payload?.success) {
        throw new Error(payload?.error_code ?? "list_rental_money_register_failed");
      }

      return (payload.entries ?? []).map((row) => mapRegisterEntry(row));
    },
    select: (entries) => {
      const stornoByOriginal = new Map<string, number>();
      const hasReplacement = new Set<string>();
      for (const entry of entries) {
        if (entry.operationKind === "storno" && entry.reversesPaymentId) {
          stornoByOriginal.set(
            entry.reversesPaymentId,
            (stornoByOriginal.get(entry.reversesPaymentId) ?? 0) + entry.amount
          );
        }
        if (entry.replacesPaymentId) hasReplacement.add(entry.replacesPaymentId);
      }
      return entries.map((entry) => {
        if (entry.entryType !== "direct_booking_payment" && entry.entryType !== "direct_booking_storno") {
          return entry;
        }
        if (entry.operationKind === "storno") {
          return { ...entry, correctionStatus: "storno" as const };
        }
        const stornoTotal = stornoByOriginal.get(entry.id) ?? 0;
        const remaining = Math.max(0, entry.amount - stornoTotal);
        let correctionStatus = entry.correctionStatus ?? ("active" as const);
        if (hasReplacement.has(entry.id)) correctionStatus = "replaced";
        else if (stornoTotal >= entry.amount && stornoTotal > 0) correctionStatus = "voided";
        else if (stornoTotal > 0) correctionStatus = "partially_voided";
        return { ...entry, remainingAmount: remaining, correctionStatus };
      });
    },
    staleTime: 30 * 1000,
  });
}
