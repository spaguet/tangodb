import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { rentersQueryKey } from "./useRenters";

export type PackSurchargeReviewStatus = "pending" | "applied" | "waived";

export interface PackSurchargeReviewItem {
  id: string;
  rentalSeriesId: string;
  renterId: string;
  status: PackSurchargeReviewStatus;
  suggestedAmount: number;
  currency: string;
  cancelMode: string;
  usedWeekCount: number;
  reasonCode: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewNotes: string | null;
  seriesValidFrom: string;
  seriesValidTo: string;
  locationId: string;
}

function mapReview(row: Record<string, unknown>): PackSurchargeReviewItem {
  return {
    id: String(row.id),
    rentalSeriesId: String(row.rental_series_id),
    renterId: String(row.renter_id),
    status: String(row.status) as PackSurchargeReviewStatus,
    suggestedAmount: Number(row.suggested_amount ?? 0),
    currency: String(row.currency ?? "RUB"),
    cancelMode: String(row.cancel_mode ?? ""),
    usedWeekCount: Number(row.used_week_count ?? 1),
    reasonCode: String(row.reason_code ?? ""),
    createdAt: String(row.created_at),
    reviewedAt: row.reviewed_at != null ? String(row.reviewed_at) : null,
    reviewNotes: row.review_notes != null ? String(row.review_notes) : null,
    seriesValidFrom: String(row.series_valid_from).slice(0, 10),
    seriesValidTo: String(row.series_valid_to).slice(0, 10),
    locationId: String(row.location_id),
  };
}

export function renterPackSurchargeReviewsQueryKey(renterId?: string | null) {
  return [...rentersQueryKey, "packSurchargeReviews", renterId ?? "all"] as const;
}

export function useRenterPackSurchargeReviews(renterId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(renterPackSurchargeReviewsQueryKey(renterId)),
    enabled: orgEnabled && enabled && renterId != null,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renter_pack_surcharge_reviews", {
        p_renter_id: renterId,
      });
      if (error) throw error;
      const result = data as { success?: boolean; error?: string; items?: Record<string, unknown>[] };
      if (!result?.success) {
        throw new Error(result?.error ?? "renter.surchargeReview.loadFailed");
      }
      return (result.items ?? []).map(mapReview);
    },
    staleTime: 30_000,
  });
}

export function useApplyRenterPackSurcharge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { seriesId: string; notes?: string; idempotencyKey?: string }) => {
      const { data, error } = await supabase.rpc("apply_renter_pack_surcharge", {
        p_series_id: input.seriesId,
        p_idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
        p_notes: input.notes ?? null,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string; applied_amount?: number };
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renter.surchargeReview.applyFailed" };
      }
      return {
        success: true as const,
        appliedAmount: Number(result.applied_amount ?? 0),
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rentersQueryKey });
    },
  });
}

export function useWaiveRenterPackSurcharge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { seriesId: string; notes?: string }) => {
      const { data, error } = await supabase.rpc("waive_renter_pack_surcharge", {
        p_series_id: input.seriesId,
        p_notes: input.notes ?? null,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string };
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renter.surchargeReview.waiveFailed" };
      }
      return { success: true as const };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rentersQueryKey });
    },
  });
}
