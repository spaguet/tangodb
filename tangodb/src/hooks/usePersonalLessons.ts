import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { PersonalLesson } from "../types";

export const personalLessonsQueryKey = ["personalLessons"] as const;

const mapPersonalLesson = (row: Record<string, unknown>): PersonalLesson => ({
  id: row.id as string,
  type: row.type as string,
  clientId1: (row.client_id1 as string) || "",
  clientId2: (row.client_id2 as string) || "",
  clientId3: (row.client_id3 as string) || "",
  date: String(row.date ?? "").slice(0, 10),
  price: Number(row.price) || 0,
  paid: (row.paid as "yes" | "no") || "no",
});

export function usePersonalLessons() {
  return useQuery({
    queryKey: personalLessonsQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("personal_lessons")
        .select("*")
        .order("date", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapPersonalLesson);
    },
    staleTime: 30 * 1000,
  });
}

export function useAddPersonalLessons() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (lessons: {
      type: string;
      clientId1: string;
      clientId2: string;
      clientId3: string;
      dates: string[];
      price: number;
      paid: boolean;
    }) => {
      if (!lessons.dates.length) {
        return { success: false as const, error: "Нет дат для бронирования" };
      }

      const paid = lessons.paid ? "yes" : "no";
      const baseId = Date.now();
      const rows = lessons.dates.map((date, i) => ({
        id: String(baseId + i),
        type: lessons.type,
        client_id1: lessons.clientId1 || null,
        client_id2: lessons.clientId2 || null,
        client_id3: lessons.clientId3 || null,
        date,
        price: lessons.price,
        paid,
      }));

      const { error } = await supabase.from("personal_lessons").insert(rows);
      if (error) return { success: false as const, error: error.message };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
    },
  });
}

export function useUpdatePersonalPaid() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, paid }: { id: string; paid: boolean }) => {
      const { data, error } = await supabase
        .from("personal_lessons")
        .update({ paid: paid ? "yes" : "no" })
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error) return { success: false as const, error: error.message };
      if (!data) return { success: false as const, error: "Урок не найден" };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
    },
  });
}

export function useDeletePersonalLesson() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("personal_lessons")
        .delete()
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error) return { success: false as const, error: error.message };
      if (!data) return { success: false as const, error: "Урок не найден" };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
    },
  });
}
