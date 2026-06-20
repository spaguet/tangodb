import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Discipline } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const disciplinesQueryKey = ["disciplines"] as const;

const mapDiscipline = (row: Record<string, unknown>): Discipline => ({
  id: String(row.id),
  name: row.name as string,
  description: (row.description as string) || "",
  createdAt: row.created_at as string | undefined,
});

export function useDisciplines(options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(disciplinesQueryKey),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.from("disciplines").select("*").order("name");
      if (error) throw error;
      return (data ?? []).map(mapDiscipline);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddDiscipline() {
  const queryClient = useQueryClient();
  const { organizationId, withOrgId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({ name, description }: { name: string; description: string }) => {
      if (!organizationId) {
        return { success: false as const, error: "Организация не выбрана" };
      }

      const trimmed = name.trim();
      if (!trimmed) return { success: false as const, error: "Укажите название дисциплины" };

      const cached = queryClient.getQueryData<Discipline[]>(withOrgId(disciplinesQueryKey)) ?? [];
      if (cached.some((d) => d.name.toLowerCase() === trimmed.toLowerCase())) {
        return { success: false as const, error: "Такая дисциплина уже есть" };
      }

      const { data, error } = await supabase
        .from("disciplines")
        .insert({
          organization_id: organizationId,
          name: trimmed,
          description: description.trim(),
        })
        .select("*")
        .single();

      if (error) return { success: false as const, error: error.message };
      return { success: true as const, discipline: mapDiscipline(data as Record<string, unknown>) };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: disciplinesQueryKey });
    },
  });
}

export function useUpdateDiscipline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      name,
      description,
    }: {
      id: string;
      name: string;
      description: string;
    }) => {
      const trimmed = name.trim();
      if (!trimmed) return { success: false as const, error: "Укажите название дисциплины" };

      const { error } = await supabase
        .from("disciplines")
        .update({ name: trimmed, description: description.trim() })
        .eq("id", id);

      if (error) {
        if (error.code === "23505") {
          return { success: false as const, error: "Дисциплина с таким названием уже существует" };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: disciplinesQueryKey });
    },
  });
}

export function useDeleteDiscipline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("disciplines").delete().eq("id", id);
      if (error) {
        if (error.code === "23503") {
          return {
            success: false as const,
            error: "Дисциплина используется в расписании, абонементах или уроках",
          };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: disciplinesQueryKey });
    },
  });
}
