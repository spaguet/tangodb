import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Price, PriceCategory } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const pricesQueryKey = ["prices"] as const;

type PriceTeacherRow = { member_id: string };

const mapPrice = (row: Record<string, unknown>): Price => {
  const teacherRows = (row.price_teacher_members as PriceTeacherRow[] | null | undefined) ?? [];
  const teacherMemberIds = teacherRows
    .map((item) => item.member_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  return {
    id: String(row.id),
    type: row.type as string,
    lessons: row.lessons as number,
    price: Number(row.price),
    label: (row.label as string) || undefined,
    description: (row.description as string) || undefined,
    category: row.category as PriceCategory,
    locationId: row.location_id != null ? String(row.location_id) : null,
    disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
    teacherMemberIds,
    billingModel: (row.billing_model as Price["billingModel"]) || "lesson_count",
  };
};

export function usePrices() {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(pricesQueryKey),
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prices")
        .select("*, price_teacher_members(member_id)")
        .order("type")
        .order("lessons");
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
      teacherMemberIds,
    }: {
      id: string;
      label: string;
      description: string;
      locationId?: string | null;
      disciplineId?: string | null;
      teacherMemberIds?: string[];
    }) => {
      const payload: Record<string, unknown> = {
        label: label.trim(),
        description: description.trim(),
      };
      if (locationId !== undefined) payload.location_id = locationId;
      if (disciplineId !== undefined) payload.discipline_id = disciplineId;

      const { error } = await supabase.from("prices").update(payload).eq("id", id);
      if (error) return { success: false as const, error: error.message };

      if (teacherMemberIds !== undefined) {
        const teacherResult = await syncPriceTeacherMembers(id, teacherMemberIds);
        if (teacherResult.success === false) {
          return { success: false as const, error: teacherResult.error };
        }
      }

      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    },
  });
}

async function syncPriceTeacherMembers(
  priceId: string,
  teacherMemberIds: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  const { error: deleteError } = await supabase
    .from("price_teacher_members")
    .delete()
    .eq("price_id", priceId);
  if (deleteError) return { success: false as const, error: deleteError.message };

  if (teacherMemberIds.length === 0) {
    return { success: true as const };
  }

  const { data: priceRow, error: priceError } = await supabase
    .from("prices")
    .select("organization_id")
    .eq("id", priceId)
    .maybeSingle();
  if (priceError) return { success: false as const, error: priceError.message };
  if (!priceRow?.organization_id) return { success: false as const, error: "Price not found" };

  const { error: insertError } = await supabase.from("price_teacher_members").insert(
    teacherMemberIds.map((memberId) => ({
      organization_id: priceRow.organization_id,
      price_id: priceId,
      member_id: memberId,
    }))
  );
  if (insertError) return { success: false as const, error: insertError.message };

  return { success: true as const };
}

export function useUpdatePriceTeachers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      priceId,
      teacherMemberIds,
    }: {
      priceId: string;
      teacherMemberIds: string[];
    }) => {
      const result = await syncPriceTeacherMembers(priceId, teacherMemberIds);
      if (!result.success) return result;
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
      teacherMemberIds,
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
      teacherMemberIds?: string[];
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

      if (teacherMemberIds && teacherMemberIds.length > 0) {
        const teacherResult = await syncPriceTeacherMembers(String(data.id), teacherMemberIds);
        if (teacherResult.success === false) {
          return { success: false as const, error: teacherResult.error };
        }
      }

      return { success: true as const, price: mapPrice({ ...data, price_teacher_members: [] }) };
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
