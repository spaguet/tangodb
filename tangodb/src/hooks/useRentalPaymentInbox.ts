import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { normalizeTime } from "../lib/scheduleWeek";
import type { RentalPaymentStatus } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { rentalsQueryKey } from "./useRentals";

export const rentalPaymentInboxQueryKey = ["rentalPaymentInbox"] as const;

export type RentalInboxBucket = "queue" | "today" | "overdue" | "partial" | "overpaid" | "unpaid";

export interface RentalPaymentInboxItem {
  rentalId: string;
  rentalDate: string;
  timeStart: string;
  timeEnd: string;
  locationId: string | null;
  locationName: string | null;
  rentalSeriesId: string | null;
  purpose: string | null;
  renterId: string;
  renterName: string;
  currency: string;
  effectiveAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: RentalPaymentStatus;
  lastPaymentBy: string | null;
  isOverdue: boolean;
}

export interface RentalPaymentInboxFilter {
  bucket?: RentalInboxBucket;
  asOfDate?: string;
  locationId?: string | null;
  renterId?: string | null;
  paymentStatus?: RentalPaymentStatus | null;
  cashierId?: string | null;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}

function mapInboxItem(row: Record<string, unknown>): RentalPaymentInboxItem {
  return {
    rentalId: String(row.rental_id),
    rentalDate: String(row.rental_date).slice(0, 10),
    timeStart: normalizeTime(String(row.time_start)),
    timeEnd: normalizeTime(String(row.time_end)),
    locationId: row.location_id != null ? String(row.location_id) : null,
    locationName: row.location_name != null ? String(row.location_name) : null,
    rentalSeriesId: row.rental_series_id != null ? String(row.rental_series_id) : null,
    purpose: row.purpose != null ? String(row.purpose) : null,
    renterId: String(row.renter_id),
    renterName: String(row.renter_name ?? ""),
    currency: row.currency != null ? String(row.currency) : "RUB",
    effectiveAmount: Number(row.effective_amount) || 0,
    paidAmount: Number(row.paid_amount) || 0,
    remainingAmount: Number(row.remaining_amount) || 0,
    paymentStatus: (row.payment_status as RentalPaymentStatus) ?? "unpaid",
    lastPaymentBy: row.last_payment_by != null ? String(row.last_payment_by) : null,
    isOverdue: Boolean(row.is_overdue),
  };
}

export function useRentalPaymentInbox(filter: RentalPaymentInboxFilter = {}) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (filter.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...rentalPaymentInboxQueryKey, filter]),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_rental_payment_inbox", {
        p_bucket: filter.bucket ?? "queue",
        p_as_of_date: filter.asOfDate ?? null,
        p_location_id: filter.locationId ?? null,
        p_renter_id: filter.renterId ?? null,
        p_payment_status: filter.paymentStatus ?? null,
        p_cashier_id: filter.cashierId ?? null,
        p_limit: filter.limit ?? 50,
        p_offset: filter.offset ?? 0,
      });

      if (error) throw error;

      const payload = data as {
        success?: boolean;
        error_code?: string;
        as_of_date?: string;
        bucket?: string;
        total?: number;
        limit?: number;
        offset?: number;
        items?: Record<string, unknown>[];
      } | null;

      if (!payload?.success) {
        throw new Error(payload?.error_code ?? "rentalInbox.error.loadFailed");
      }

      return {
        asOfDate: String(payload.as_of_date ?? ""),
        bucket: (payload.bucket as RentalInboxBucket) ?? "queue",
        total: Number(payload.total ?? 0),
        limit: Number(payload.limit ?? 50),
        offset: Number(payload.offset ?? 0),
        items: (payload.items ?? []).map(mapInboxItem),
      };
    },
    staleTime: 15 * 1000,
  });
}

export function invalidateRentalPaymentInbox(queryClient: {
  invalidateQueries: (opts: { queryKey: readonly unknown[]; refetchType?: "active" }) => void;
}) {
  void queryClient.invalidateQueries({ queryKey: rentalPaymentInboxQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentalsQueryKey, refetchType: "active" });
}
