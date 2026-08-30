import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { locationsQueryKey } from "./useLocations";

export const locationRentalHourRatesQueryKey = ["locationRentalHourRates"] as const;

export type HourRateKind = "one_time" | "recurring" | "penalty";

export interface LocationHourRateRow {
  id: string;
  kind: HourRateKind;
  price: number | null;
  currency: string | null;
  validFrom: string;
}

export interface LocationHourRatesLocation {
  locationId: string;
  name: string;
  miniappEnabled: boolean;
  kindsComplete: boolean;
  rates: LocationHourRateRow[];
}

export interface LocationHourRatesPayload {
  addonActive: boolean;
  addonStatus: string | null;
  addonPeriodStart: string | null;
  addonPeriodEnd: string | null;
  canWrite: boolean;
  showPrices: boolean;
  penaltyRateGap: boolean;
  locations: LocationHourRatesLocation[];
}

function mapRate(row: Record<string, unknown>): LocationHourRateRow {
  return {
    id: String(row.id),
    kind: (row.kind as HourRateKind) ?? "one_time",
    price: row.price != null ? Number(row.price) : null,
    currency: row.currency != null ? String(row.currency) : null,
    validFrom: String(row.valid_from ?? "").slice(0, 10),
  };
}

function mapLocation(row: Record<string, unknown>): LocationHourRatesLocation {
  return {
    locationId: String(row.location_id),
    name: String(row.name ?? ""),
    miniappEnabled: Boolean(row.miniapp_enabled),
    kindsComplete: Boolean(row.kinds_complete),
    rates: Array.isArray(row.rates)
      ? (row.rates as Record<string, unknown>[]).map(mapRate)
      : [],
  };
}

export function useLocationRentalHourRates(enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(locationRentalHourRatesQueryKey),
    enabled: orgEnabled && enabled,
    queryFn: async (): Promise<LocationHourRatesPayload> => {
      const { data, error } = await supabase.rpc("list_location_rental_hour_rates");
      if (error) throw error;
      const result = data as {
        success?: boolean;
        error?: string;
        addon_active?: boolean;
        addon_status?: string | null;
        addon_period_start?: string | null;
        addon_period_end?: string | null;
        can_write?: boolean;
        show_prices?: boolean;
        penalty_rate_gap?: boolean;
        locations?: unknown[];
      } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "hallRent.miniapp.error.loadFailed");
      }
      return {
        addonActive: Boolean(result.addon_active),
        addonStatus: result.addon_status ?? null,
        addonPeriodStart: result.addon_period_start
          ? String(result.addon_period_start).slice(0, 10)
          : null,
        addonPeriodEnd: result.addon_period_end
          ? String(result.addon_period_end).slice(0, 10)
          : null,
        canWrite: Boolean(result.can_write),
        showPrices: Boolean(result.show_prices),
        penaltyRateGap: Boolean(result.penalty_rate_gap),
        locations: (result.locations ?? []).map((row) => mapLocation(row as Record<string, unknown>)),
      };
    },
    staleTime: 30 * 1000,
  });
}

export function useUpsertLocationRentalHourRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      locationId: string;
      kind: HourRateKind;
      price: number;
      validFrom?: string;
    }) => {
      const { data, error } = await supabase.rpc("upsert_location_rental_hour_rate", {
        p_payload: asJson({
          location_id: input.locationId,
          kind: input.kind,
          price: input.price,
          valid_from: input.validFrom ?? null,
        }),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "hallRent.miniapp.error.saveRate" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: locationRentalHourRatesQueryKey,
          refetchType: "active",
        });
      }
    },
  });
}

export function useSetLocationMiniappEnabled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { locationId: string; enabled: boolean }) => {
      const { data, error } = await supabase.rpc("set_location_miniapp_enabled", {
        p_location_id: input.locationId,
        p_enabled: input.enabled,
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "hallRent.miniapp.error.saveFlag" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: locationRentalHourRatesQueryKey,
          refetchType: "active",
        });
        void queryClient.invalidateQueries({ queryKey: locationsQueryKey, refetchType: "active" });
      }
    },
  });
}
