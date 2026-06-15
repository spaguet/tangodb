import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { formatClientName } from "../lib/utils";
import type { PersonalLesson } from "../types";

export const personalLessonsQueryKey = ["personalLessons"] as const;

type ClientJoinRow = { first_name?: string; last_name?: string } | null;

const asId = (value: unknown): string => (value == null ? "" : String(value).trim());

const clientNameFromJoin = (row: ClientJoinRow, fallbackId: string): string => {
  if (row && (row.last_name || row.first_name)) {
    return formatClientName(row.last_name ?? "", row.first_name ?? "");
  }
  if (!fallbackId) return "";
  // Legacy rows may store a display name instead of an ID.
  if (/[^\d]/.test(fallbackId)) return fallbackId;
  return fallbackId;
};

const joinClientNames = (parts: string[]): string =>
  parts.filter(Boolean).join(" & ") || "Клиент не указан";

const mapPersonalLesson = (row: Record<string, unknown>): PersonalLesson => {
  const clientId1 = asId(row.client_id1);
  const clientId2 = asId(row.client_id2);
  const clientId3 = asId(row.client_id3);

  return {
    id: row.id as string,
    type: row.type as string,
    clientId1,
    clientId2,
    clientId3,
    clientDisplay: joinClientNames([
      clientNameFromJoin(row.client1 as ClientJoinRow, clientId1),
      clientId2 ? clientNameFromJoin(row.client2 as ClientJoinRow, clientId2) : "",
      clientId3 ? clientNameFromJoin(row.client3 as ClientJoinRow, clientId3) : "",
    ]),
    date: String(row.date ?? "").slice(0, 10),
    timeStart: (row.time_start as string) || "14:00",
    timeEnd: (row.time_end as string) || "15:00",
    price: Number(row.price) || 0,
    paid: (row.paid as "yes" | "no") || "no",
    disciplineId: row.discipline_id != null ? (row.discipline_id as number) : null,
    subscriptionId: row.subscription_id != null ? (row.subscription_id as string) : null,
    attendanceStatus: (row.attendance_status as "present" | "absent" | null) ?? null,
  };
};

const personalLessonsSelect =
  "id, type, client_id1, client_id2, client_id3, discipline_id, date, time_start, time_end, price, paid, subscription_id, attendance_status, client1:clients!client_id1(first_name, last_name), client2:clients!client_id2(first_name, last_name), client3:clients!client_id3(first_name, last_name)";

export function usePersonalLessons(yearMonth?: string) {
  return useQuery({
    queryKey: yearMonth ? [...personalLessonsQueryKey, yearMonth] : personalLessonsQueryKey,
    queryFn: async () => {
      let query = supabase
        .from("personal_lessons")
        .select(personalLessonsSelect)
        .order("date", { ascending: false });

      if (yearMonth) {
        const [y, m] = yearMonth.split("-").map(Number);
        const start = `${y}-${String(m).padStart(2, "0")}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        query = query.gte("date", start).lte("date", end);
      }

      let { data, error } = await query;

      if (error) {
        let fallbackQuery = supabase
          .from("personal_lessons")
          .select("*")
          .order("date", { ascending: false });
        if (yearMonth) {
          const [y, m] = yearMonth.split("-").map(Number);
          const start = `${y}-${String(m).padStart(2, "0")}-01`;
          const lastDay = new Date(y, m, 0).getDate();
          const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
          fallbackQuery = fallbackQuery.gte("date", start).lte("date", end);
        }
        const fallback = await fallbackQuery;
        if (fallback.error) throw fallback.error;
        data = fallback.data;
      }

      return (data ?? []).map((row) => mapPersonalLesson(row as Record<string, unknown>));
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
      timeStart: string;
      timeEnd: string;
      price: number;
      paid: boolean;
      disciplineId: number;
      subscriptionId?: string;
    }) => {
      if (!lessons.dates.length) {
        return { success: false as const, error: "Нет дат для бронирования" };
      }

      const paid = lessons.subscriptionId || lessons.paid ? "yes" : "no";
      const rows = lessons.dates.map((date) => ({
        id: crypto.randomUUID(),
        type: lessons.type,
        client_id1: lessons.clientId1 || null,
        client_id2: lessons.clientId2 || null,
        client_id3: lessons.clientId3 || null,
        date,
        time_start: lessons.timeStart,
        time_end: lessons.timeEnd,
        price: lessons.subscriptionId ? 0 : lessons.price,
        paid,
        discipline_id: lessons.disciplineId,
        subscription_id: lessons.subscriptionId || null,
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

export function useUpdatePersonalLesson() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      date,
      timeStart,
      timeEnd,
    }: {
      id: string;
      date: string;
      timeStart: string;
      timeEnd: string;
    }) => {
      const { data, error } = await supabase
        .from("personal_lessons")
        .update({ date, time_start: timeStart, time_end: timeEnd })
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

export function useMarkPersonalLessonAttendance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      lessonId,
      status,
    }: {
      lessonId: string;
      status: "present" | "absent";
    }) => {
      const { data, error } = await supabase.rpc("mark_personal_lesson_attendance", {
        p_lesson_id: lessonId,
        p_new_status: status,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "Не удалось сохранить изменения" };
      }

      return { success: true as const };
    },
    onMutate: async ({ lessonId, status }) => {
      await queryClient.cancelQueries({ queryKey: personalLessonsQueryKey });

      const previousEntries = queryClient.getQueriesData<PersonalLesson[]>({
        queryKey: personalLessonsQueryKey,
      });
      queryClient.setQueriesData<PersonalLesson[]>(
        { queryKey: personalLessonsQueryKey },
        (old) =>
          (old ?? []).map((l) => (l.id === lessonId ? { ...l, attendanceStatus: status } : l))
      );

      return { previousEntries };
    },
    onError: (_err, _vars, context) => {
      if (context?.previousEntries) {
        for (const [key, data] of context.previousEntries) {
          queryClient.setQueryData(key, data);
        }
      }
    },
    onSettled: (result) => {
      if (result?.success) {
        void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
      }
    },
  });
}
