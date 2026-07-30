import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { PaymentMethod, RentalPayment } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const rentalPaymentsQueryKey = ["rentalPayments"] as const;

export interface RentalPaymentFilter {
  dateFrom?: string;
  dateTo?: string;
  enabled?: boolean;
}

const mapRentalPayment = (row: Record<string, unknown>): RentalPayment => ({
  id: String(row.id),
  rentalId: String(row.rental_id),
  amount: Number(row.amount) || 0,
  currency: String(row.currency ?? "RUB"),
  method: (row.method as PaymentMethod) || "cash",
  methodComment: row.method_comment != null ? String(row.method_comment) : null,
  createdAt: String(row.created_at ?? ""),
  renterDisplay:
    row.renter_display != null
      ? String(row.renter_display)
      : row.rentals != null
        ? String((row.rentals as Record<string, unknown>).renter_display ?? "")
        : undefined,
  locationId:
    row.location_id != null
      ? String(row.location_id)
      : row.rentals != null
        ? String((row.rentals as Record<string, unknown>).location_id ?? "")
        : null,
  rentalDate:
    row.rental_date != null
      ? String(row.rental_date).slice(0, 10)
      : row.rentals != null
        ? String((row.rentals as Record<string, unknown>).rental_date ?? "").slice(0, 10)
        : undefined,
});

export function useRentalPayments(filter?: RentalPaymentFilter) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (filter?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId([...rentalPaymentsQueryKey, filter ?? {}]),
    enabled: queryEnabled,
    queryFn: async () => {
      let query = supabase
        .from("rental_payments")
        .select(
          `
          id,
          rental_id,
          amount,
          currency,
          method,
          method_comment,
          created_at,
          rentals (
            rental_date,
            location_id,
            renters ( display_name )
          )
        `
        )
        .order("created_at", { ascending: false });

      if (filter?.dateFrom) query = query.gte("created_at", `${filter.dateFrom}T00:00:00`);
      if (filter?.dateTo) query = query.lte("created_at", `${filter.dateTo}T23:59:59`);

      const { data, error } = await query;
      if (error) throw error;

      return (data ?? []).map((row) => {
        const raw = row as Record<string, unknown>;
        const rentalsRaw = raw.rentals as Record<string, unknown> | Record<string, unknown>[] | null;
        const rental = Array.isArray(rentalsRaw) ? rentalsRaw[0] : rentalsRaw;
        const rentersRaw = rental?.renters as Record<string, unknown> | Record<string, unknown>[] | null;
        const renter = Array.isArray(rentersRaw) ? rentersRaw[0] : rentersRaw;

        return mapRentalPayment({
          ...raw,
          rental_date: rental?.rental_date,
          location_id: rental?.location_id,
          renter_display: renter?.display_name,
        });
      });
    },
    staleTime: 30 * 1000,
  });
}
