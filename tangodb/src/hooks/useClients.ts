import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Client } from "../types";

export const clientsQueryKey = ["clients"] as const;

const mapClient = (row: Record<string, unknown>): Client => ({
  id: row.id as string,
  firstName: row.first_name as string,
  lastName: row.last_name as string,
  telegram: (row.telegram as string) || "",
  createdAt: row.created_at as string | undefined,
});

export function useClients() {
  return useQuery({
    queryKey: clientsQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").order("last_name");
      if (error) throw error;
      return (data ?? []).map(mapClient);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      firstName,
      lastName,
      telegram,
    }: {
      firstName: string;
      lastName: string;
      telegram: string;
    }) => {
      const fTrim = firstName.trim();
      const lTrim = lastName.trim();
      const cached = queryClient.getQueryData<Client[]>(clientsQueryKey) ?? [];
      const exists = cached.some(
        (c) => c.firstName.toLowerCase() === fTrim.toLowerCase() && c.lastName.toLowerCase() === lTrim.toLowerCase()
      );
      if (exists) {
        return { success: false as const, error: "Клиент с таким именем и фамилией уже существует" };
      }

      const id = String(Date.now());
      const { error } = await supabase.from("clients").insert({
        id,
        first_name: fTrim,
        last_name: lTrim,
        telegram: telegram.trim(),
      });
      if (error) return { success: false as const, error: error.message };
      return { success: true as const, id };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
  });
}

export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      clientId,
      firstName,
      lastName,
      telegram,
    }: {
      clientId: string;
      firstName: string;
      lastName: string;
      telegram: string;
    }) => {
      const { error } = await supabase
        .from("clients")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          telegram: telegram.trim(),
        })
        .eq("id", clientId);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", clientId);
      if (error) {
        if (error.code === "23503") {
          return { success: false as const, error: "Клиент используется в абонементах или уроках" };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
  });
}
