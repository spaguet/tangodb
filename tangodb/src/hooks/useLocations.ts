import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";

export interface Location {
  id: string;
  name: string;
  address: string;
  createdAt?: string;
}

export const locationsQueryKey = ["locations"] as const;

const mapLocation = (row: Record<string, unknown>): Location => ({
  id: row.id as string,
  name: row.name as string,
  address: (row.address as string) || "",
  createdAt: row.created_at as string | undefined,
});

export function useLocations() {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(locationsQueryKey),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("locations").select("*").order("name");
      if (error) throw error;
      return (data ?? []).map(mapLocation);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddLocation() {
  const queryClient = useQueryClient();
  const { organizationId, withOrgId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({ name, address }: { name: string; address: string }) => {
      if (!organizationId) {
        return { success: false as const, error: "Организация не выбрана" };
      }

      const trimmed = name.trim();
      if (!trimmed) return { success: false as const, error: "Укажите название локации" };

      const cached = queryClient.getQueryData<Location[]>(withOrgId(locationsQueryKey)) ?? [];
      if (cached.some((l) => l.name.toLowerCase() === trimmed.toLowerCase())) {
        return { success: false as const, error: "Такая локация уже есть" };
      }

      const { data, error } = await supabase
        .from("locations")
        .insert({
          organization_id: organizationId,
          name: trimmed,
          address: address.trim(),
        })
        .select("*")
        .single();

      if (error) return { success: false as const, error: error.message };
      return { success: true as const, location: mapLocation(data as Record<string, unknown>) };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: locationsQueryKey });
    },
  });
}

export function useUpdateLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      name,
      address,
    }: {
      id: string;
      name: string;
      address: string;
    }) => {
      const trimmed = name.trim();
      if (!trimmed) return { success: false as const, error: "Укажите название локации" };

      const { error } = await supabase
        .from("locations")
        .update({ name: trimmed, address: address.trim() })
        .eq("id", id);

      if (error) {
        if (error.code === "23505") {
          return { success: false as const, error: "Локация с таким названием уже существует" };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: locationsQueryKey });
    },
  });
}

export function useDeleteLocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("locations").delete().eq("id", id);
      if (error) {
        if (error.code === "23503") {
          return {
            success: false as const,
            error: "Локация используется в расписании или классах",
          };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: locationsQueryKey });
    },
  });
}
