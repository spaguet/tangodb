import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Price, PriceCategory } from "../types";
import type { Database } from "../types/database";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const pricesQueryKey = ["prices"] as const;

type PricesInsert = Database["public"]["Tables"]["prices"]["Insert"];
type PricesUpdate = Database["public"]["Tables"]["prices"]["Update"];

type PriceTeacherRow = { member_id: string };
type PriceDisciplineRow = { discipline_id: string };

const mapPrice = (row: Record<string, unknown>): Price => {
  const teacherRows = (row.price_teacher_members as PriceTeacherRow[] | null | undefined) ?? [];
  const teacherMemberIds = Array.isArray(row.teacher_member_ids)
    ? row.teacher_member_ids.map(String)
    : teacherRows
        .map((item) => item.member_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

  const disciplineRows = (row.price_disciplines as PriceDisciplineRow[] | null | undefined) ?? [];
  const disciplineIdsFromJunction = Array.isArray(row.discipline_ids)
    ? row.discipline_ids.map(String)
    : disciplineRows
        .map((item) => item.discipline_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);
  const legacyDisciplineId = row.discipline_id != null ? String(row.discipline_id) : null;
  const disciplineIds =
    disciplineIdsFromJunction.length > 0
      ? disciplineIdsFromJunction
      : legacyDisciplineId
        ? [legacyDisciplineId]
        : [];

  return {
    id: String(row.id),
    type: row.type as string,
    lessons: row.lessons as number,
    price: Number(row.price),
    label: (row.label as string) || undefined,
    description: (row.description as string) || undefined,
    category: row.category as PriceCategory,
    locationId: row.location_id != null ? String(row.location_id) : null,
    disciplineId: disciplineIds.length === 1 ? disciplineIds[0] : legacyDisciplineId,
    disciplineIds,
    teacherMemberIds,
    billingModel: (row.billing_model as Price["billingModel"]) || "lesson_count",
    freezeMaxCount: row.freeze_max_count != null ? Number(row.freeze_max_count) : null,
    freezeMinLessons: row.freeze_min_lessons != null ? Number(row.freeze_min_lessons) : null,
    status: row.status === "archived" ? "archived" : "active",
    createdAt: row.created_at != null ? String(row.created_at) : undefined,
    archivedAt: row.archived_at != null ? String(row.archived_at) : null,
    salesCount: row.sales_count != null ? Number(row.sales_count) : undefined,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
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
        .select("*, price_teacher_members(member_id), price_disciplines(discipline_id)")
        .eq("status", "active")
        .order("type")
        .order("lessons");
      if (error) throw error;
      return (data ?? []).map(mapPrice);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useArchivedPrices(enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...pricesQueryKey, "archived"]),
    enabled: orgEnabled && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_archived_prices");
      if (error) throw error;

      const result = data as { success?: boolean; error?: string; prices?: unknown[] } | null;
      if (!result?.success) throw new Error(result?.error ?? "prices.error.loadFailed");
      return (result.prices ?? []).map((row) => mapPrice(row as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
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

export function useUnpaidPersonalLessonsCountByPrice(priceId: string | null | undefined) {
  const { enabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId([...pricesQueryKey, "unpaidByPrice", priceId]),
    enabled: enabled && !!priceId,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("personal_lessons")
        .select("id", { count: "exact", head: true })
        .eq("price_id", priceId!)
        .is("subscription_id", null)
        .gt("price", 0)
        .neq("paid", "yes");
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 30_000,
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
      disciplineIds,
      teacherMemberIds,
      durationMinutes,
    }: {
      id: string;
      label: string;
      description: string;
      locationId?: string | null;
      disciplineIds?: string[];
      teacherMemberIds?: string[];
      durationMinutes?: number | null;
    }) => {
      const payload: PricesUpdate = {
        label: label.trim(),
        description: description.trim(),
      };
      if (durationMinutes !== undefined) payload.duration_minutes = durationMinutes;
      if (locationId !== undefined) payload.location_id = locationId;
      if (disciplineIds !== undefined) {
        payload.discipline_id = disciplineIds.length === 1 ? disciplineIds[0] : null;
      }

      const { error } = await supabase.from("prices").update(payload).eq("id", id);
      if (error) return { success: false as const, error: error.message };

      if (disciplineIds !== undefined) {
        const disciplineResult = await syncPriceDisciplines(id, disciplineIds);
        if (disciplineResult.success === false) {
          return { success: false as const, error: disciplineResult.error };
        }
      }

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

type PriceTeacherSnapshotRow = { organization_id: string; member_id: string };
type PriceDisciplineSnapshotRow = { organization_id: string; discipline_id: string };

async function restorePriceTeacherMembers(
  priceId: string,
  rows: PriceTeacherSnapshotRow[]
): Promise<void> {
  if (rows.length === 0) return;
  await supabase.from("price_teacher_members").insert(
    rows.map((row) => ({
      organization_id: row.organization_id,
      price_id: priceId,
      member_id: row.member_id,
    }))
  );
}

async function restorePriceDisciplines(
  priceId: string,
  rows: PriceDisciplineSnapshotRow[]
): Promise<void> {
  if (rows.length === 0) return;
  await supabase.from("price_disciplines").insert(
    rows.map((row) => ({
      organization_id: row.organization_id,
      price_id: priceId,
      discipline_id: row.discipline_id,
    }))
  );
}

async function deleteCreatedPrice(priceId: string): Promise<void> {
  await supabase.from("prices").delete().eq("id", priceId);
}

async function syncPriceTeacherMembers(
  priceId: string,
  teacherMemberIds: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  const { data: existingRows, error: selectError } = await supabase
    .from("price_teacher_members")
    .select("organization_id, member_id")
    .eq("price_id", priceId);
  if (selectError) return { success: false as const, error: selectError.message };

  const snapshot = (existingRows ?? []) as PriceTeacherSnapshotRow[];

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
  if (priceError) {
    await restorePriceTeacherMembers(priceId, snapshot);
    return { success: false as const, error: priceError.message };
  }
  if (!priceRow?.organization_id) {
    await restorePriceTeacherMembers(priceId, snapshot);
    return { success: false as const, error: "Price not found" };
  }

  const { error: insertError } = await supabase.from("price_teacher_members").insert(
    teacherMemberIds.map((memberId) => ({
      organization_id: priceRow.organization_id,
      price_id: priceId,
      member_id: memberId,
    }))
  );
  if (insertError) {
    await restorePriceTeacherMembers(priceId, snapshot);
    return { success: false as const, error: insertError.message };
  }

  return { success: true as const };
}

async function syncPriceDisciplines(
  priceId: string,
  disciplineIds: string[]
): Promise<{ success: true } | { success: false; error: string }> {
  const { data: existingRows, error: selectError } = await supabase
    .from("price_disciplines")
    .select("organization_id, discipline_id")
    .eq("price_id", priceId);
  if (selectError) return { success: false as const, error: selectError.message };

  const snapshot = (existingRows ?? []) as PriceDisciplineSnapshotRow[];

  const { error: deleteError } = await supabase
    .from("price_disciplines")
    .delete()
    .eq("price_id", priceId);
  if (deleteError) return { success: false as const, error: deleteError.message };

  if (disciplineIds.length === 0) {
    return { success: true as const };
  }

  const { data: priceRow, error: priceError } = await supabase
    .from("prices")
    .select("organization_id")
    .eq("id", priceId)
    .maybeSingle();
  if (priceError) {
    await restorePriceDisciplines(priceId, snapshot);
    return { success: false as const, error: priceError.message };
  }
  if (!priceRow?.organization_id) {
    await restorePriceDisciplines(priceId, snapshot);
    return { success: false as const, error: "Price not found" };
  }

  const { error: insertError } = await supabase.from("price_disciplines").insert(
    disciplineIds.map((disciplineId) => ({
      organization_id: priceRow.organization_id,
      price_id: priceId,
      discipline_id: disciplineId,
    }))
  );
  if (insertError) {
    await restorePriceDisciplines(priceId, snapshot);
    return { success: false as const, error: insertError.message };
  }

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
      disciplineIds,
      billingModel,
      teacherMemberIds,
      durationMinutes,
    }: {
      type: string;
      lessons: number;
      price: number;
      label: string;
      description: string;
      category: PriceCategory;
      locationId?: string | null;
      disciplineIds?: string[];
      billingModel?: Price["billingModel"];
      teacherMemberIds?: string[];
      durationMinutes?: number | null;
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "onboarding.error.noOrgSelected" };
      }

      const insertPayload: PricesInsert = {
        organization_id: organizationId,
        type: type.trim(),
        lessons,
        price,
        label: label.trim(),
        description: description.trim(),
        category,
        location_id: locationId ?? null,
        discipline_id: disciplineIds?.length === 1 ? disciplineIds[0] : null,
        billing_model: billingModel ?? "lesson_count",
      };
      if (durationMinutes != null && durationMinutes > 0) {
        insertPayload.duration_minutes = durationMinutes;
      }

      const { data, error } = await supabase
        .from("prices")
        .insert(insertPayload)
        .select("*")
        .single();

      if (error) return { success: false as const, error: error.message };

      const priceId = String(data.id);

      if (disciplineIds && disciplineIds.length > 0) {
        const disciplineResult = await syncPriceDisciplines(priceId, disciplineIds);
        if (disciplineResult.success === false) {
          await deleteCreatedPrice(priceId);
          return { success: false as const, error: disciplineResult.error };
        }
      }

      if (teacherMemberIds && teacherMemberIds.length > 0) {
        const teacherResult = await syncPriceTeacherMembers(priceId, teacherMemberIds);
        if (teacherResult.success === false) {
          await deleteCreatedPrice(priceId);
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

export function useArchivePrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("prices")
        .update({ status: "archived", archived_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "active");
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    },
  });
}

export function useRestorePrice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("prices")
        .update({ status: "active", archived_at: null })
        .eq("id", id)
        .eq("status", "archived");
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: pricesQueryKey });
    },
  });
}
