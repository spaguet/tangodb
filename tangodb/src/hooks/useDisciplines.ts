import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Discipline } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const disciplinesQueryKey = ["disciplines"] as const;

const mapDiscipline = (row: Record<string, unknown>): Discipline => ({
  id: String(row.id),
  name: row.name as string,
  description: (row.description as string) || "",
  category: (row.category as string | null) ?? null,
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
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const trimmed = name.trim();
      if (!trimmed) return { success: false as const, error: "hooks.error.disciplineNameRequired" };

      const cached = queryClient.getQueryData<Discipline[]>(withOrgId(disciplinesQueryKey)) ?? [];
      if (cached.some((d) => d.name.toLowerCase() === trimmed.toLowerCase())) {
        return { success: false as const, error: "hooks.error.disciplineDuplicate" };
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
      category,
    }: {
      id: string;
      name: string;
      description: string;
      category?: string | null;
    }) => {
      const trimmed = name.trim();
      if (!trimmed) return { success: false as const, error: "hooks.error.disciplineNameRequired" };

      const { error } = await supabase
        .from("disciplines")
        .update({
          name: trimmed,
          description: description.trim(),
          category: category?.trim() ? category.trim() : null,
        })
        .eq("id", id);

      if (error) {
        if (error.code === "23505") {
          return { success: false as const, error: "hooks.error.disciplineDuplicateName" };
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
            error: "hooks.error.disciplineInUse",
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
