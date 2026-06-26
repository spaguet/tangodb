import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Price, PriceCategory } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const pricesQueryKey = ["prices"] as const;

const mapPrice = (row: Record<string, unknown>): Price => ({
  id: String(row.id),
  type: row.type as string,
  lessons: row.lessons as number,
  price: Number(row.price),
  label: (row.label as string) || undefined,
  description: (row.description as string) || undefined,
  category: row.category as PriceCategory,
  locationId: row.location_id != null ? String(row.location_id) : null,
  disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
  billingModel: (row.billing_model as Price["billingModel"]) || "lesson_count",
});

export function usePrices() {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(pricesQueryKey),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("prices").select("*").order("type").order("lessons");
      if (error) throw error;
      return (data ?? []).map(mapPrice);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdatePrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, newPrice }: { id: string; newPrice: number }) => {
      const { error } = await supabase.from("prices").update({ price: newPrice }).eq("id", id);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    },
  });
}

export function useUpdatePriceMeta() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      label,
      description,
      locationId,
      disciplineId,
    }: {
      id: string;
      label: string;
      description: string;
      locationId?: string | null;
      disciplineId?: string | null;
    }) => {
      const payload: Record<string, unknown> = {
        label: label.trim(),
        description: description.trim(),
      };
      if (locationId !== undefined) payload.location_id = locationId;
      if (disciplineId !== undefined) payload.discipline_id = disciplineId;

      const { error } = await supabase.from("prices").update(payload).eq("id", id);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    },
  });
}

export function useCreatePrice() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({
      type,
      lessons,
      price,
      label,
      description,
      category,
      locationId,
      disciplineId,
      billingModel,
    }: {
      type: string;
      lessons: number;
      price: number;
      label: string;
      description: string;
      category: PriceCategory;
      locationId?: string | null;
      disciplineId?: string | null;
      billingModel?: Price["billingModel"];
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const { data, error } = await supabase
        .from("prices")
        .insert({
          organization_id: organizationId,
          type: type.trim(),
          lessons,
          price,
          label: label.trim(),
          description: description.trim(),
          category,
          location_id: locationId ?? null,
          discipline_id: disciplineId ?? null,
          billing_model: billingModel ?? "lesson_count",
        })
        .select("*")
        .single();

      if (error) return { success: false as const, error: error.message };
      return { success: true as const, price: mapPrice(data) };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    },
  });
}

export function useDeletePrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prices").delete().eq("id", id);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    },
  });
}
