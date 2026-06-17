import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { reportClientError } from "../lib/reportClientError";
import { supabase } from "../lib/supabase";
import { normalizeTelegramForStorage } from "../lib/telegram";
import type { Client } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const clientsQueryKey = ["clients"] as const;

export function clientsListQueryKey(includeArchived: boolean) {
  return [...clientsQueryKey, { includeArchived }] as const;
}

const mapClient = (row: Record<string, unknown>): Client => ({
  id: row.id as string,
  firstName: row.first_name as string,
  lastName: row.last_name as string,
  telegram: (row.telegram as string) || "",
  createdAt: row.created_at as string | undefined,
  archivedAt: (row.archived_at as string | null) ?? null,
});

export function useClients(options?: { includeArchived?: boolean }) {
  const includeArchived = options?.includeArchived ?? false;
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(clientsListQueryKey(includeArchived)),
    enabled,
    queryFn: async () => {
      let query = supabase.from("clients").select("*").order("last_name");
      if (!includeArchived) query = query.is("archived_at", null);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []).map(mapClient);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export const useActiveClients = () => useClients();
export const useClientDirectory = () => useClients({ includeArchived: true });

export function useAddClient() {
  const queryClient = useQueryClient();
  const { withOrgId } = useOrgQueryScope();

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
      const cached =
        queryClient.getQueryData<Client[]>(withOrgId(clientsListQueryKey(false))) ?? [];
      const exists = cached.some(
        (c) =>
          !c.archivedAt &&
          c.firstName.toLowerCase() === fTrim.toLowerCase() &&
          c.lastName.toLowerCase() === lTrim.toLowerCase()
      );
      if (exists) {
        return { success: false as const, error: "Клиент с таким именем и фамилией уже существует" };
      }

      const id = crypto.randomUUID();
      const { error } = await supabase.from("clients").insert({
        id,
        first_name: fTrim,
        last_name: lTrim,
        telegram: normalizeTelegramForStorage(telegram),
      });
      if (error) {
        if (error.code === "23505") {
          return {
            success: false as const,
            error: "Клиент с таким именем и фамилией уже существует",
          };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const, id };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
    onError: (error) => {
      reportClientError(error, { area: "mutation", action: "useAddClient" });
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
          telegram: normalizeTelegramForStorage(telegram),
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

export function useArchiveClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", clientId)
        .is("archived_at", null);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
    onError: (error) => {
      reportClientError(error, { area: "mutation", action: "useArchiveClient" });
    },
  });
}

export function useRestoreClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (clientId: string) => {
      const { error } = await supabase
        .from("clients")
        .update({ archived_at: null })
        .eq("id", clientId)
        .not("archived_at", "is", null);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: clientsQueryKey });
    },
  });
}
