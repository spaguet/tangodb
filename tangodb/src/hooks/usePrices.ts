import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Price } from "../types";

export const pricesQueryKey = ["prices"] as const;

const mapPrice = (row: Record<string, unknown>): Price => ({
  id: row.id as number,
  type: row.type as string,
  lessons: row.lessons as number,
  price: Number(row.price),
});

export function usePrices() {
  return useQuery({
    queryKey: pricesQueryKey,
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
    mutationFn: async ({ id, newPrice }: { id: number; newPrice: number }) => {
      const { error } = await supabase.from("prices").update({ price: newPrice }).eq("id", id);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    },
  });
}
