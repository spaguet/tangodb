import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { normalizeTime } from "../lib/scheduleWeek";
import type { RentalTariff, RentalTariffRule, RentalTariffStatus, RentalTariffType } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const rentalTariffsQueryKey = ["rental-tariffs"] as const;

export interface RentalTariffsFilters {
  status?: RentalTariffStatus | null;
  locationId?: string | null;
}

function mapTariff(row: Record<string, unknown>): RentalTariff {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    tariffType: (row.tariff_type as RentalTariffType) ?? "hourly",
    locationId: row.location_id != null ? String(row.location_id) : null,
    price: row.price != null ? Number(row.price) : null,
    currency: row.currency != null ? String(row.currency) : null,
    minDurationMinutes: Number(row.min_duration_minutes ?? 0),
    roundingStepMinutes: Number(row.rounding_step_minutes ?? 1),
    validFrom: row.valid_from != null ? String(row.valid_from).slice(0, 10) : null,
    validTo: row.valid_to != null ? String(row.valid_to).slice(0, 10) : null,
    status: (row.status as RentalTariffStatus) ?? "active",
    rulesCount: Number(row.rules_count ?? 0),
  };
}

function mapRule(row: Record<string, unknown>): RentalTariffRule {
  return {
    id: String(row.id),
    priority: Number(row.priority ?? 0),
    daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week.map(Number) : [],
    timeStart: normalizeTime(String(row.time_start ?? "09:00")),
    timeEnd: normalizeTime(String(row.time_end ?? "18:00")),
    priceOverride: Number(row.price_override ?? 0),
    validFrom: row.valid_from != null ? String(row.valid_from).slice(0, 10) : null,
    validTo: row.valid_to != null ? String(row.valid_to).slice(0, 10) : null,
  };
}

export function useRentalTariffs(filters: RentalTariffsFilters = {}, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...rentalTariffsQueryKey, filters]),
    enabled: orgEnabled && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_rental_tariffs", {
        p_status: filters.status ?? null,
        p_location_id: filters.locationId ?? null,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string; tariffs?: unknown[] } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "rentalTariffs.error.loadFailed");
      }

      return (result.tariffs ?? []).map((row) => mapTariff(row as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
  });
}

export function useRentalTariffRules(tariffId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...rentalTariffsQueryKey, "rules", tariffId]),
    enabled: orgEnabled && enabled && !!tariffId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("rental_tariff_rules")
        .select("id, priority, days_of_week, time_start, time_end, price_override, valid_from, valid_to")
        .eq("tariff_id", tariffId!)
        .order("priority", { ascending: false });

      if (error) throw error;
      return (data ?? []).map((row) => mapRule(row as Record<string, unknown>));
    },
    staleTime: 0,
  });
}

export interface UpsertRentalTariffInput {
  tariffId?: string;
  name: string;
  tariffType: RentalTariffType;
  status?: RentalTariffStatus;
  locationId?: string | null;
  price: number;
  currency?: string;
  minDurationMinutes?: number;
  roundingStepMinutes?: number;
  validFrom?: string | null;
  validTo?: string | null;
  rules?: RentalTariffRule[];
}

function rulesToPayload(rules: RentalTariffRule[]) {
  return rules.map((rule) => ({
    priority: rule.priority,
    days_of_week: rule.daysOfWeek,
    time_start: rule.timeStart,
    time_end: rule.timeEnd,
    price_override: rule.priceOverride,
    valid_from: rule.validFrom ?? null,
    valid_to: rule.validTo ?? null,
  }));
}

export function useUpsertRentalTariff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: UpsertRentalTariffInput) => {
      const payload: Record<string, unknown> = {
        name: input.name,
        tariff_type: input.tariffType,
        status: input.status ?? "active",
        location_id: input.locationId ?? null,
        price: input.price,
        currency: input.currency ?? "RUB",
        min_duration_minutes: input.minDurationMinutes ?? 0,
        rounding_step_minutes: input.roundingStepMinutes ?? 1,
        valid_from: input.validFrom ?? null,
        valid_to: input.validTo ?? null,
      };

      if (input.tariffId) payload.tariff_id = input.tariffId;
      if (input.rules) payload.rules = rulesToPayload(input.rules);

      const { data, error } = await supabase.rpc("upsert_rental_tariff", { p_payload: payload });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; tariff_id?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalTariffs.error.saveFailed" };
      }

      return { success: true as const, tariffId: result.tariff_id ?? "" };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rentalTariffsQueryKey, refetchType: "active" });
    },
  });
}
