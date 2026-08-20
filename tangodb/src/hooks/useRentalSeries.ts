import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import type { Json } from "../types/database";
import { normalizeTime } from "../lib/scheduleWeek";
import type {
  RentalSeries,
  RentalSeriesPattern,
  RentalSeriesPreviewOccurrence,
  RentalSeriesStatus,
  RentalTariffType,
} from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { rentalsQueryKey } from "./useRentals";
import { scheduleQueryKey } from "./useSchedule";

export const rentalSeriesQueryKey = ["rental-series"] as const;

function mapConflict(row: unknown): unknown {
  return row;
}

function mapPreviewOccurrence(row: Record<string, unknown>): RentalSeriesPreviewOccurrence {
  return {
    occurrenceDate: String(row.occurrence_date).slice(0, 10),
    timeStart: normalizeTime(String(row.time_start)),
    timeEnd: normalizeTime(String(row.time_end)),
    patternId: row.pattern_id != null ? String(row.pattern_id) : null,
    locationId: String(row.location_id),
    calculatedAmount: row.calculated_amount != null ? Number(row.calculated_amount) : null,
    currency: row.currency != null ? String(row.currency) : null,
    tariffType: (row.tariff_type as RentalTariffType | null) ?? null,
    pricingBreakdown: row.pricing_breakdown ?? null,
    conflicts: Array.isArray(row.conflicts) ? row.conflicts.map(mapConflict) : [],
    hasConflict: Boolean(row.has_conflict),
  };
}

export interface RentalSeriesPayload {
  renterId: string;
  locationId: string;
  tariffId: string;
  validFrom: string;
  validTo: string;
  contractId?: string | null;
  purpose?: string;
  patterns: RentalSeriesPattern[];
}

function seriesPayloadObject(input: RentalSeriesPayload) {
  return {
    renter_id: input.renterId,
    location_id: input.locationId,
    tariff_id: input.tariffId,
    valid_from: input.validFrom,
    valid_to: input.validTo,
    contract_id: input.contractId ?? null,
    purpose: input.purpose ?? null,
    patterns: input.patterns.map((p) => ({
      days_of_week: p.daysOfWeek,
      time_start: p.timeStart,
      time_end: p.timeEnd,
    })),
  };
}

function seriesPayloadToRpc(input: RentalSeriesPayload): Json {
  return asJson(seriesPayloadObject(input));
}

function invalidateSeriesQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: rentalSeriesQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentalsQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: scheduleQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["rentalMoneyRegister"], refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: ["renterFinance"], refetchType: "active" });
}

export function usePreviewRentalSeries(payload: RentalSeriesPayload | null, enabled: boolean) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...rentalSeriesQueryKey, "preview", payload]),
    enabled: orgEnabled && enabled && !!payload && payload.patterns.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("preview_rental_series", {
        p_payload: seriesPayloadToRpc(payload!),
      });

      if (error) throw error;

      const result = data as {
        success?: boolean;
        error?: string;
        occurrences?: Record<string, unknown>[];
        occurrence_count?: number;
        total_amount?: number | null;
        has_conflicts?: boolean;
      } | null;

      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "rentalSeries.error.previewFailed",
          occurrences: [] as RentalSeriesPreviewOccurrence[],
          occurrenceCount: 0,
          totalAmount: null as number | null,
          hasConflicts: false,
        };
      }

      return {
        success: true as const,
        occurrences: (result.occurrences ?? []).map(mapPreviewOccurrence),
        occurrenceCount: Number(result.occurrence_count ?? 0),
        totalAmount: result.total_amount != null ? Number(result.total_amount) : null,
        hasConflicts: Boolean(result.has_conflicts),
      };
    },
    staleTime: 0,
  });
}

export interface CreateRentalSeriesInput extends RentalSeriesPayload {
  idempotencyKey: string;
}

export function useCreateRentalSeries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRentalSeriesInput) => {
      const { data, error } = await supabase.rpc("create_rental_series", {
        p_payload: asJson({
          ...seriesPayloadObject(input),
          idempotency_key: input.idempotencyKey,
        }),
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        series_id?: string;
        rental_ids?: string[];
        already_applied?: boolean;
        preview?: Record<string, unknown>;
      } | null;

      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "rentalSeries.error.createFailed",
          preview: result?.preview,
        };
      }

      return {
        success: true as const,
        seriesId: result.series_id ?? "",
        rentalIds: (result.rental_ids ?? []).map(String),
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: () => invalidateSeriesQueries(queryClient),
  });
}

export type RentalSeriesFinancialAction =
  | "none"
  | "full_penalty"
  | "partial_penalty"
  | "manual"
  | "refund"
  | "transfer_to_advance";

/** Shared with single rental cancel (stage 11). */
export type RentalCancelFinancialAction = RentalSeriesFinancialAction;

export function useCancelRentalSeriesOccurrence() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      seriesId: string;
      date: string;
      reason: string;
      financialAction?: RentalSeriesFinancialAction;
      penaltyAmount?: number | null;
      idempotencyKey?: string;
    }) => {
      const { data, error } = await supabase.rpc("cancel_rental_series_occurrence", {
        p_series_id: input.seriesId,
        p_date: input.date,
        p_reason: input.reason,
        p_financial_action: input.financialAction ?? "none",
        p_penalty_amount: input.penaltyAmount ?? null,
        p_idempotency_key: input.idempotencyKey ?? null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; already_applied?: boolean } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalSeries.error.cancelOccurrenceFailed" };
      }

      return { success: true as const, alreadyApplied: result.already_applied ?? false };
    },
    onSuccess: () => invalidateSeriesQueries(queryClient),
  });
}

export function useUpdateRentalSeries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      seriesId: string;
      payload: Record<string, unknown>;
      scope?: "single" | "future" | "all";
    }) => {
      const { data, error } = await supabase.rpc("update_rental_series", {
        p_series_id: input.seriesId,
        p_payload: asJson(input.payload),
        p_scope: input.scope ?? "future",
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalSeries.error.updateFailed" };
      }

      return { success: true as const };
    },
    onSuccess: () => invalidateSeriesQueries(queryClient),
  });
}

export interface RentalSeriesDetail {
  series: RentalSeries;
  patterns: RentalSeriesPattern[];
  occurrences: {
    rentalId: string;
    rentalDate: string;
    timeStart: string;
    timeEnd: string;
    bookingStatus: "confirmed" | "cancelled";
    calculatedAmount: number | null;
    finalAmount: number | null;
    currency: string | null;
    paidAmount: number | null;
  }[];
  exceptions: {
    exceptionDate: string;
    reason: string;
    financialAction: string;
    penaltyAmount: number | null;
    cancelledAt: string;
  }[];
}

export function useRentalSeriesDetail(seriesId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...rentalSeriesQueryKey, "detail", seriesId]),
    enabled: orgEnabled && enabled && !!seriesId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_series_detail", {
        p_series_id: seriesId!,
      });

      if (error) throw error;

      const result = data as {
        success?: boolean;
        error?: string;
        series?: Record<string, unknown>;
        patterns?: Record<string, unknown>[];
        occurrences?: Record<string, unknown>[];
        exceptions?: Record<string, unknown>[];
      } | null;

      if (!result?.success || !result.series) {
        throw new Error(result?.error ?? "rentalSeries.error.notFound");
      }

      const s = result.series;

      return {
        series: {
          id: String(s.id),
          renterId: String(s.renter_id),
          contractId: s.contract_id != null ? String(s.contract_id) : null,
          locationId: String(s.location_id),
          tariffId: String(s.tariff_id),
          validFrom: String(s.valid_from).slice(0, 10),
          validTo: String(s.valid_to).slice(0, 10),
          status: (s.status as RentalSeriesStatus) ?? "active",
          purpose: s.purpose != null ? String(s.purpose) : null,
        },
        patterns: (result.patterns ?? []).map(
          (p): RentalSeriesPattern => ({
            id: String(p.id),
            daysOfWeek: Array.isArray(p.days_of_week) ? p.days_of_week.map(Number) : [],
            timeStart: normalizeTime(String(p.time_start)),
            timeEnd: normalizeTime(String(p.time_end)),
          })
        ),
        occurrences: (result.occurrences ?? []).map((o) => ({
          rentalId: String(o.rental_id),
          rentalDate: String(o.rental_date).slice(0, 10),
          timeStart: normalizeTime(String(o.time_start)),
          timeEnd: normalizeTime(String(o.time_end)),
          bookingStatus: (o.booking_status as "confirmed" | "cancelled") ?? "confirmed",
          calculatedAmount: o.calculated_amount != null ? Number(o.calculated_amount) : null,
          finalAmount: o.final_amount != null ? Number(o.final_amount) : null,
          currency: o.currency != null ? String(o.currency) : null,
          paidAmount: o.paid_amount != null ? Number(o.paid_amount) : null,
        })),
        exceptions: (result.exceptions ?? []).map((e) => ({
          exceptionDate: String(e.exception_date).slice(0, 10),
          reason: String(e.reason ?? ""),
          financialAction: String(e.financial_action ?? "none"),
          penaltyAmount: e.penalty_amount != null ? Number(e.penalty_amount) : null,
          cancelledAt: String(e.cancelled_at ?? ""),
        })),
      } satisfies RentalSeriesDetail;
    },
    staleTime: 0,
  });
}
