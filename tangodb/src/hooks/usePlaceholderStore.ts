/**
 * Временный in-memory store до подключения TanStack Query + Supabase (промты 2–8).
 */
import { useCallback, useEffect, useState } from "react";
import type {
  AttendanceRecord,
  Client,
  PersonalLesson,
  Price,
  ScheduleSlot,
  Subscription,
} from "../types";

const DEFAULT_CLIENTS: Client[] = [
  { id: "101", firstName: "Alejandro", lastName: "Silva", telegram: "https://t.me/alesilva" },
  { id: "102", firstName: "Elisa", lastName: "Rossi", telegram: "https://t.me/elisatango" },
  { id: "103", firstName: "Carlos", lastName: "Gardel", telegram: "https://t.me/gardeltango" },
  { id: "104", firstName: "Maria", lastName: "Nieves", telegram: "https://t.me/marianieves" },
];

const DEFAULT_SCHEDULE: ScheduleSlot[] = [
  { dayOfWeek: 1, time: "19:00" },
  { dayOfWeek: 3, time: "19:00" },
  { dayOfWeek: 6, time: "15:00" },
];

const DEFAULT_PRICES: Price[] = [
  { row: 2, type: "solo", lessons: 4, price: 1200000 },
  { row: 3, type: "solo", lessons: 8, price: 2100000 },
  { row: 4, type: "pair_m1", lessons: 8, price: 3400000 },
  { row: 5, type: "pair_m2", lessons: 8, price: 3100000 },
  { row: 6, type: "pair_m3", lessons: 8, price: 2800000 },
  { row: 7, type: "pair_hm", lessons: 4, price: 1800000 },
  { row: 8, type: "personal_solo", lessons: 1, price: 900000 },
  { row: 9, type: "personal_pair", lessons: 1, price: 1300000 },
  { row: 10, type: "personal_trio", lessons: 1, price: 1600000 },
];

const DEFAULT_SUBSCRIPTIONS: Subscription[] = [
  {
    id: "sub-1",
    type: "pair",
    clientId1: "101",
    clientId2: "102",
    lessonsTotal: 8,
    lessonsLeft: 6,
    freezeUsed: 0,
    activationDate: "2026-06-01",
    status: "active",
    pairMonth: "1",
  },
  {
    id: "sub-2",
    type: "solo",
    clientId1: "103",
    clientId2: "",
    lessonsTotal: 8,
    lessonsLeft: 2,
    freezeUsed: 1,
    activationDate: "2026-05-18",
    status: "active",
    pairMonth: "",
  },
];

const DEFAULT_ATTENDANCE: AttendanceRecord[] = [
  {
    date: "2026-06-01",
    subscriptionId: "sub-1",
    clientDisplay: "Silva Alejandro & Rossi Elisa",
    attendanceStatus: "present",
  },
];

const DEFAULT_PERSONAL: PersonalLesson[] = [
  {
    id: "p-1",
    type: "solo",
    clientId1: "103",
    clientId2: "",
    clientId3: "",
    date: "2026-06-08",
    price: 900000,
    paid: "yes",
  },
];

export function usePlaceholderStore() {
  const [clients, setClients] = useState<Client[]>([]);
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [personalLessons, setPersonalLessons] = useState<PersonalLesson[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setClients(DEFAULT_CLIENTS);
    setSchedule(DEFAULT_SCHEDULE);
    setPrices(DEFAULT_PRICES);
    setSubscriptions(DEFAULT_SUBSCRIPTIONS);
    setAttendance(DEFAULT_ATTENDANCE);
    setPersonalLessons(DEFAULT_PERSONAL);
    setLoading(false);
  }, []);

  const addClient = async (firstName: string, lastName: string, telegram: string) => {
    const fTrim = firstName.trim();
    const lTrim = lastName.trim();
    const exists = clients.some(
      (c) => c.firstName.toLowerCase() === fTrim.toLowerCase() && c.lastName.toLowerCase() === lTrim.toLowerCase()
    );
    if (exists) return { success: false as const, error: "Клиент с таким именем и фамилией уже существует" };
    const id = String(Date.now());
    setClients((prev) => [...prev, { id, firstName: fTrim, lastName: lTrim, telegram: telegram.trim() }]);
    return { success: true as const, id };
  };

  const updateClient = async (clientId: string, firstName: string, lastName: string, telegram: string) => {
    setClients((prev) =>
      prev.map((c) =>
        c.id === clientId
          ? { ...c, firstName: firstName.trim(), lastName: lastName.trim(), telegram: telegram.trim() }
          : c
      )
    );
    return { success: true as const };
  };

  const deleteClient = async (clientId: string) => {
    setClients((prev) => prev.filter((c) => c.id !== clientId));
    return { success: true as const };
  };

  const addScheduleSlot = async (dayOfWeek: number, time: string) => {
    if (schedule.some((s) => s.dayOfWeek === dayOfWeek && s.time === time)) {
      return { success: false as const, error: "Такой день и время уже есть в расписании" };
    }
    setSchedule((prev) => [...prev, { dayOfWeek, time }].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time)));
    return { success: true as const };
  };

  const deleteScheduleSlot = async (dayOfWeek: number, time: string) => {
    setSchedule((prev) => prev.filter((s) => !(s.dayOfWeek === dayOfWeek && s.time === time)));
    return { success: true as const };
  };

  const updatePrice = async (rowIndex: number, newPrice: number) => {
    setPrices((prev) => prev.map((p) => (p.row === rowIndex ? { ...p, price: newPrice } : p)));
    return { success: true as const };
  };

  const addSubscription = async (sub: {
    type: string;
    clientId1: string;
    clientId2: string;
    lessonsTotal: number;
    activationDate: string;
    pairMonth: number | "" | string;
  }) => {
    const id = `sub-${Date.now()}`;
    const newSub: Subscription = {
      id,
      type: sub.type,
      clientId1: sub.clientId1,
      clientId2: sub.clientId2,
      lessonsTotal: sub.lessonsTotal,
      lessonsLeft: sub.lessonsTotal,
      freezeUsed: 0,
      activationDate: sub.activationDate,
      status: "active",
      pairMonth: sub.pairMonth != null && sub.pairMonth !== "" ? String(sub.pairMonth) : "",
    };
    setSubscriptions((prev) => [...prev, newSub]);
    return { success: true as const, id };
  };

  const finishSubscription = async (subId: string) => {
    setSubscriptions((prev) => prev.map((s) => (s.id === subId ? { ...s, status: "finished" } : s)));
    return { success: true as const };
  };

  const getScheduleDatesForMonth = useCallback(
    (yearMonth: string) => {
      if (!schedule.length || !yearMonth) return [];
      const [yearStr, monthStr] = yearMonth.split("-");
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);
      const daysInMonth = new Date(year, month, 0).getDate();
      const dates: { date: string; time: string }[] = [];
      for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month - 1, day);
        const jsDay = date.getDay();
        const dow = jsDay === 0 ? 7 : jsDay;
        schedule.forEach((slot) => {
          if (slot.dayOfWeek === dow) {
            const dd = String(day).padStart(2, "0");
            const mm = String(month).padStart(2, "0");
            dates.push({ date: `${year}-${mm}-${dd}`, time: slot.time });
          }
        });
      }
      return dates.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
    },
    [schedule]
  );

  const getSubsForDate = useCallback(
    (dateStr: string) => {
      const clientMap = Object.fromEntries(clients.map((c) => [c.id, c]));
      return subscriptions
        .filter((s) => s.status === "active" && s.activationDate <= dateStr && s.lessonsLeft > 0)
        .map((s) => {
          const c1 = clientMap[s.clientId1];
          const c2 = s.clientId2 ? clientMap[s.clientId2] : null;
          const existing = attendance.find((a) => a.date === dateStr && a.subscriptionId === s.id);
          return {
            subId: s.id,
            type: s.type,
            client1: c1 ? `${c1.lastName} ${c1.firstName}` : s.clientId1,
            client2: c2 ? `${c2.lastName} ${c2.firstName}` : "",
            lessonsLeft: s.lessonsLeft,
            lessonsTotal: s.lessonsTotal,
            freezeUsed: s.freezeUsed,
            activationDate: s.activationDate,
            currentStatus: (existing?.attendanceStatus ?? null) as "present" | "absent" | "freeze" | null,
            canFreeze: s.lessonsTotal === 8 && s.freezeUsed === 0,
          };
        });
    },
    [clients, subscriptions, attendance]
  );

  const markAttendance = async (dateStr: string, subId: string, newStatus: "present" | "absent" | "freeze") => {
    const sub = subscriptions.find((s) => s.id === subId);
    if (!sub) return { success: false as const, error: "Абонемент не найден" };
    const existing = attendance.find((a) => a.date === dateStr && a.subscriptionId === subId);
    const oldStatus = existing?.attendanceStatus ?? null;
    if (oldStatus === newStatus) return { success: true as const, newLessonsLeft: sub.lessonsLeft };

    let lessonDelta = 0;
    let freezeDelta = 0;
    if (oldStatus === "present" || oldStatus === "absent") lessonDelta += 1;
    if (oldStatus === "freeze") freezeDelta -= 1;
    if (newStatus === "present" || newStatus === "absent") lessonDelta -= 1;
    if (newStatus === "freeze") freezeDelta += 1;
    if (
      (oldStatus === "present" || oldStatus === "absent") &&
      (newStatus === "present" || newStatus === "absent")
    ) {
      lessonDelta = 0;
    }
    if (newStatus === "freeze") {
      if (sub.lessonsTotal !== 8) return { success: false as const, error: "Заморозка только для абонементов на 8 уроков" };
      if (sub.freezeUsed + freezeDelta > 1) return { success: false as const, error: "Заморозка уже использована" };
    }

    const nextLessons = sub.lessonsLeft + lessonDelta;
    if (nextLessons < 0) return { success: false as const, error: "Недостаточно уроков" };

    const c1 = clients.find((c) => c.id === sub.clientId1);
    const c2 = sub.clientId2 ? clients.find((c) => c.id === sub.clientId2) : null;
    let display = c1 ? `${c1.lastName} ${c1.firstName}` : sub.clientId1;
    if (c2) display += ` & ${c2.lastName} ${c2.firstName}`;

    setSubscriptions((prev) =>
      prev.map((s) =>
        s.id === subId
          ? {
              ...s,
              lessonsLeft: nextLessons,
              freezeUsed: s.freezeUsed + freezeDelta,
              status: nextLessons === 0 ? "finished" : s.status,
            }
          : s
      )
    );
    setAttendance((prev) => {
      if (existing) {
        return prev.map((a) =>
          a.date === dateStr && a.subscriptionId === subId ? { ...a, attendanceStatus: newStatus, clientDisplay: display } : a
        );
      }
      return [...prev, { date: dateStr, subscriptionId: subId, clientDisplay: display, attendanceStatus: newStatus }];
    });
    return { success: true as const, newLessonsLeft: nextLessons };
  };

  const addPersonalLessons = async (lessons: {
    type: string;
    clientId1: string;
    clientId2: string;
    clientId3: string;
    dates: string[];
    price: number;
    paid: boolean;
  }) => {
    if (!lessons.dates.length) return { success: false as const, error: "Нет дат для бронирования" };
    const newItems = lessons.dates.map((date, i) => ({
      id: `p-${Date.now() + i}`,
      type: lessons.type,
      clientId1: lessons.clientId1,
      clientId2: lessons.clientId2,
      clientId3: lessons.clientId3,
      date,
      price: lessons.price,
      paid: lessons.paid ? ("yes" as const) : ("no" as const),
    }));
    setPersonalLessons((prev) => [...prev, ...newItems]);
    return { success: true as const };
  };

  const updatePersonalLessonPaid = async (rowIndex: number, paid: boolean, id?: string) => {
    setPersonalLessons((prev) =>
      prev.map((l) => {
        const isTarget = id ? l.id === id : l.id === String(rowIndex);
        return isTarget ? { ...l, paid: paid ? "yes" : "no" } : l;
      })
    );
    return { success: true as const };
  };

  const deletePersonalLessonRow = async (rowIndex: number, id?: string) => {
    setPersonalLessons((prev) => prev.filter((l) => (id ? l.id !== id : l.id !== String(rowIndex))));
    return { success: true as const };
  };

  return {
    clients,
    schedule,
    prices,
    subscriptions,
    attendance,
    personalLessons,
    loading,
    addClient,
    updateClient,
    deleteClient,
    addScheduleSlot,
    deleteScheduleSlot,
    updatePrice,
    addSubscription,
    finishSubscription,
    getScheduleDatesForMonth,
    getSubsForDate,
    markAttendance,
    addPersonalLessons,
    updatePersonalLessonPaid,
    deletePersonalLessonRow,
  };
}
