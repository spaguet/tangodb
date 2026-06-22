import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { normalizeTime } from "../lib/scheduleWeek";
import { formatClientName } from "../lib/utils";
import type { Client, PersonalLesson } from "../types";
import { useOrganization } from "../organization/OrganizationProvider";
import { useClientDirectory } from "./useClients";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const personalLessonsQueryKey = ["personalLessons"] as const;

export interface UsePersonalLessonsOptions {
  yearMonth?: string;
  dateRange?: { start: string; end: string };
  enabled?: boolean;
}

type ClientJoinRow = { first_name?: string; last_name?: string } | null;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const asId = (value: unknown): string => (value == null ? "" : String(value).trim());

const isUuid = (value: string): boolean => UUID_RE.test(value.trim());

const clientNameFromJoin = (row: ClientJoinRow, fallbackId: string): string => {
  if (row && (row.last_name || row.first_name)) {
    return formatClientName(row.last_name ?? "", row.first_name ?? "");
  }
  if (!fallbackId || isUuid(fallbackId)) return "";
  if (/[^\d]/.test(fallbackId)) return fallbackId;
  return fallbackId;
};

const clientNameFromMap = (clientId: string, clientMap: Record<string, Client>): string => {
  const id = clientId.trim();
  if (!id) return "";
  const client = clientMap[id];
  if (client) return formatClientName(client.lastName, client.firstName);
  if (isUuid(id)) return "";
  return id;
};

const buildClientDisplay = (
  clientId1: string,
  clientId2: string,
  clientId3: string,
  clientMap: Record<string, Client>
): string =>
  joinClientNames([
    clientNameFromMap(clientId1, clientMap),
    clientId2 ? clientNameFromMap(clientId2, clientMap) : "",
    clientId3 ? clientNameFromMap(clientId3, clientMap) : "",
  ]);

const enrichLessonClientDisplay = (
  lesson: PersonalLesson,
  clientMap: Record<string, Client>
): PersonalLesson => {
  const fromDirectory = buildClientDisplay(lesson.clientId1, lesson.clientId2, lesson.clientId3, clientMap);
  if (fromDirectory !== "Клиент не указан") {
    return { ...lesson, clientDisplay: fromDirectory };
  }

  const joinDisplay = lesson.clientDisplay.trim();
  if (joinDisplay && joinDisplay !== "Клиент не указан" && !isUuid(joinDisplay.split(" & ")[0] ?? "")) {
    return lesson;
  }

  return { ...lesson, clientDisplay: fromDirectory };
};

const joinClientNames = (parts: string[]): string =>
  parts.filter(Boolean).join(" & ") || "Клиент не указан";

const mapPersonalLesson = (row: Record<string, unknown>, maskFinancial: boolean): PersonalLesson => {
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
    timeStart: normalizeTime((row.time_start as string) || "14:00"),
    timeEnd: normalizeTime((row.time_end as string) || "15:00"),
    price: maskFinancial ? 0 : Number(row.price) || 0,
    paid: (row.paid as "yes" | "no" | undefined) ?? "yes",
    disciplineId: row.discipline_id != null ? String(row.discipline_id) : null,
    subscriptionId: row.subscription_id != null ? (row.subscription_id as string) : null,
    locationId: row.location_id != null ? String(row.location_id) : null,
    teacherMemberId: row.teacher_member_id != null ? String(row.teacher_member_id) : null,
    attendanceStatus: (row.attendance_status as "present" | "absent" | null) ?? null,
  };
};

const personalLessonsSelect =
  "id, type, client_id1, client_id2, client_id3, discipline_id, date, time_start, time_end, price, paid, subscription_id, location_id, teacher_member_id, attendance_status, client1:clients!client_id1(first_name, last_name), client2:clients!client_id2(first_name, last_name), client3:clients!client_id3(first_name, last_name)";

const personalLessonsSelectTeacher =
  "id, type, client_id1, client_id2, client_id3, discipline_id, date, time_start, time_end, paid, subscription_id, location_id, teacher_member_id, attendance_status, client1:clients!client_id1(first_name, last_name), client2:clients!client_id2(first_name, last_name), client3:clients!client_id3(first_name, last_name)";

function buildQueryKeySuffix(options: UsePersonalLessonsOptions): unknown {
  if (options.dateRange) return { range: options.dateRange };
  if (options.yearMonth) return { yearMonth: options.yearMonth };
  return null;
}

export function usePersonalLessons(options?: UsePersonalLessonsOptions) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role } = useOrganization();
  const maskFinancial = role === "teacher";
  const resolved = options ?? {};
  const queryEnabled = orgEnabled && (resolved.enabled ?? true);
  const keySuffix = buildQueryKeySuffix(resolved);
  const clientsQuery = useClientDirectory({ enabled: queryEnabled });

  const lessonsQuery = useQuery({
    queryKey: withOrgId([...personalLessonsQueryKey, keySuffix, { maskFinancial }]),
    enabled: queryEnabled,
    queryFn: async () => {
      const table = maskFinancial ? "personal_lessons_teacher_v" : "personal_lessons";
      const selectColumns = maskFinancial ? personalLessonsSelectTeacher : personalLessonsSelect;
      let query = supabase.from(table).select(selectColumns).order("date", { ascending: false });

      if (resolved.dateRange) {
        query = query
          .gte("date", resolved.dateRange.start)
          .lte("date", resolved.dateRange.end);
      } else if (resolved.yearMonth) {
        const [y, m] = resolved.yearMonth.split("-").map(Number);
        const start = `${y}-${String(m).padStart(2, "0")}-01`;
        const lastDay = new Date(y, m, 0).getDate();
        const end = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
        query = query.gte("date", start).lte("date", end);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data ?? []).map((row) =>
        mapPersonalLesson(row as unknown as Record<string, unknown>, maskFinancial)
      );
    },
    staleTime: 30 * 1000,
  });

  const data = useMemo(() => {
    const lessons = lessonsQuery.data ?? [];
    const clientMap = Object.fromEntries((clientsQuery.data ?? []).map((c) => [c.id, c]));
    return lessons.map((lesson) => enrichLessonClientDisplay(lesson, clientMap));
  }, [lessonsQuery.data, clientsQuery.data]);

  return {
    ...lessonsQuery,
    data,
    isLoading: lessonsQuery.isLoading || clientsQuery.isLoading,
    isError: lessonsQuery.isError || clientsQuery.isError,
    error: lessonsQuery.error ?? clientsQuery.error,
  };
}

export function useAddPersonalLessons() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async ({
      requireScope = false,
      type,
      clientId1,
      clientId2,
      clientId3,
      dates,
      timeStart,
      timeEnd,
      price,
      paid,
      disciplineId,
      locationId,
      teacherMemberId,
      subscriptionId,
    }: {
      requireScope?: boolean;
      type: string;
      clientId1: string;
      clientId2: string;
      clientId3: string;
      dates: string[];
      timeStart: string;
      timeEnd: string;
      price: number;
      paid: boolean;
      disciplineId: string;
      locationId?: string;
      teacherMemberId?: string;
      subscriptionId?: string;
    }) => {
      if (!organizationId) {
        return { success: false as const, error: "Организация не выбрана" };
      }

      if (requireScope && (!locationId || !teacherMemberId)) {
        return { success: false as const, error: "Укажите локацию и преподавателя" };
      }

      if (!dates.length) {
        return { success: false as const, error: "Нет дат для бронирования" };
      }

      const paidValue = subscriptionId || paid ? "yes" : "no";
      const rows = dates.map((date) => ({
        id: crypto.randomUUID(),
        organization_id: organizationId,
        type,
        client_id1: clientId1 || null,
        client_id2: clientId2 || null,
        client_id3: clientId3 || null,
        date,
        time_start: normalizeTime(timeStart),
        time_end: normalizeTime(timeEnd),
        price: subscriptionId ? 0 : price,
        paid: paidValue,
        discipline_id: disciplineId,
        location_id: locationId ?? null,
        teacher_member_id: teacherMemberId ?? null,
        subscription_id: subscriptionId || null,
      }));

      const { error } = await supabase.from("personal_lessons").insert(rows);
      if (error) {
        if (error.message.includes("personal_lesson_overlap") || error.message.includes("personal_group_overlap")) {
          return { success: false as const, error: "Пересечение с другим занятием в это время" };
        }
        return { success: false as const, error: error.message };
      }
      return { success: true as const, ids: rows.map((row) => row.id as string) };
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
      locationId,
      teacherMemberId,
      disciplineId,
      type,
      clientId1,
      clientId2,
      clientId3,
      price,
      paid,
      subscriptionId,
    }: {
      id: string;
      date?: string;
      timeStart?: string;
      timeEnd?: string;
      locationId?: string | null;
      teacherMemberId?: string | null;
      disciplineId?: string | null;
      type?: string;
      clientId1?: string;
      clientId2?: string;
      clientId3?: string;
      price?: number;
      paid?: boolean;
      subscriptionId?: string | null;
    }) => {
      const payload: Record<string, unknown> = {};
      if (date != null) payload.date = date;
      if (timeStart != null) payload.time_start = normalizeTime(timeStart);
      if (timeEnd != null) payload.time_end = normalizeTime(timeEnd);
      if (locationId !== undefined) payload.location_id = locationId;
      if (teacherMemberId !== undefined) payload.teacher_member_id = teacherMemberId;
      if (disciplineId !== undefined) payload.discipline_id = disciplineId;
      if (type != null) payload.type = type;
      if (clientId1 !== undefined) payload.client_id1 = clientId1 || null;
      if (clientId2 !== undefined) payload.client_id2 = clientId2 || null;
      if (clientId3 !== undefined) payload.client_id3 = clientId3 || null;
      if (price !== undefined) payload.price = price;
      if (paid !== undefined) payload.paid = paid ? "yes" : "no";
      if (subscriptionId !== undefined) payload.subscription_id = subscriptionId;

      if (Object.keys(payload).length === 0) {
        return { success: false as const, error: "Нет данных для обновления" };
      }

      const { data, error } = await supabase
        .from("personal_lessons")
        .update(payload)
        .eq("id", id)
        .select("id")
        .maybeSingle();

      if (error) {
        if (error.message.includes("personal_lesson_overlap") || error.message.includes("personal_group_overlap")) {
          return { success: false as const, error: "Пересечение с другим занятием в это время" };
        }
        return { success: false as const, error: error.message };
      }
      if (!data) return { success: false as const, error: "Урок не найден" };
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({ queryKey: personalLessonsQueryKey });
        void queryClient.invalidateQueries({ queryKey: ["schedule"] });
      }
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
