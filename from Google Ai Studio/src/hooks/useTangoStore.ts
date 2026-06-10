/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from "react";
import { Client, ScheduleSlot, Price, Subscription, AttendanceRecord, PersonalLesson } from "../types";

// Detect if we are running inside the actual Google Apps Script iframe environment
const isGAS = () => {
  return typeof window !== "undefined" && (window as any).google?.script?.run !== undefined;
};

// Helper to run Google Apps Script functions as dynamic Promises
const runGASPromise = <T>(functionName: string, ...args: any[]): Promise<T> => {
  return new Promise((resolve, reject) => {
    if (!isGAS()) {
      reject(new Error("Google Apps Script environment not detected."));
      return;
    }
    const google = (window as any).google;
    google.script.run
      .withSuccessHandler((result: T) => resolve(result))
      .withFailureHandler((error: any) => reject(error))[functionName](...args);
  });
};

// Realistic mock data for the Argentine Tango School
const DEFAULT_CLIENTS: Client[] = [
  { id: "101", firstName: "Alejandro", lastName: "Silva", telegram: "https://t.me/alesilva" },
  { id: "102", firstName: "Elisa", lastName: "Rossi", telegram: "https://t.me/elisatango" },
  { id: "103", firstName: "Carlos", lastName: "Gardel", telegram: "https://t.me/gardeltango" },
  { id: "104", firstName: "Maria", lastName: "Nieves", telegram: "https://t.me/marianieves" },
  { id: "105", firstName: "Astor", lastName: "Piazzolla", telegram: "https://t.me/astorp" },
  { id: "106", firstName: "Milena", lastName: "Milonga", telegram: "" },
  { id: "107", firstName: "Sebastian", lastName: "Arce", telegram: "https://t.me/sebarce" },
  { id: "108", firstName: "Chicho", lastName: "Frumboli", telegram: "" }
];

const DEFAULT_SCHEDULE: ScheduleSlot[] = [
  { dayOfWeek: 1, time: "19:00" }, // Monday
  { dayOfWeek: 2, time: "20:30" }, // Tuesday
  { dayOfWeek: 3, time: "19:00" }, // Wednesday
  { dayOfWeek: 4, time: "20:30" }, // Thursday
  { dayOfWeek: 6, time: "15:00" }  // Saturday
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
  { row: 10, type: "personal_trio", lessons: 1, price: 1600000 }
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
    pairMonth: 1
  },
  {
    id: "sub-2",
    type: "solo",
    clientId1: "103",
    clientId2: "",
    lessonsTotal: 8,
    lessonsLeft: 2, // warning state <= 2
    freezeUsed: 1,
    activationDate: "2026-05-18",
    status: "active",
    pairMonth: ""
  },
  {
    id: "sub-3",
    type: "solo",
    clientId1: "104",
    clientId2: "",
    lessonsTotal: 4,
    lessonsLeft: 4,
    freezeUsed: 0,
    activationDate: "2026-06-05",
    status: "active",
    pairMonth: ""
  },
  {
    id: "sub-4",
    type: "pair_hm",
    clientId1: "105",
    clientId2: "106",
    lessonsTotal: 4,
    lessonsLeft: 1, // warning
    freezeUsed: 0,
    activationDate: "2026-05-24",
    status: "active",
    pairMonth: ""
  }
];

const DEFAULT_ATTENDANCE: AttendanceRecord[] = [
  { date: "2026-06-01", subscriptionId: "sub-1", clientDisplay: "Silva Alejandro & Rossi Elisa", attendanceStatus: "present" },
  { date: "2026-06-01", subscriptionId: "sub-2", clientDisplay: "Gardel Carlos", attendanceStatus: "present" },
  { date: "2026-06-03", subscriptionId: "sub-1", clientDisplay: "Silva Alejandro & Rossi Elisa", attendanceStatus: "present" },
  { date: "2026-06-04", subscriptionId: "sub-2", clientDisplay: "Gardel Carlos", attendanceStatus: "freeze" }
];

const DEFAULT_PERSONAL_LESSONS: PersonalLesson[] = [
  {
    id: "p-1",
    type: "solo",
    clientId1: "103",
    clientId2: "",
    clientId3: "",
    date: "2026-06-08",
    price: 900000,
    paid: "yes",
    row: 2
  },
  {
    id: "p-2",
    type: "pair",
    clientId1: "104",
    clientId2: "107",
    clientId3: "",
    date: "2026-06-12",
    price: 1300000,
    paid: "no",
    row: 3
  },
  {
    id: "p-3",
    type: "trio",
    clientId1: "101",
    clientId2: "102",
    clientId3: "105",
    date: "2026-06-15",
    price: 1600000,
    paid: "no",
    row: 4
  }
];

export function useTangoStore() {
  const [clients, setClients] = useState<Client[]>([]);
  const [schedule, setSchedule] = useState<ScheduleSlot[]>([]);
  const [prices, setPrices] = useState<Price[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [personalLessons, setPersonalLessons] = useState<PersonalLesson[]>([]);
  
  const [loading, setLoading] = useState<boolean>(true);
  const [isSandboxMode, setIsSandboxMode] = useState<boolean>(false);

  // Load all initial state
  const loadData = useCallback(async () => {
    setLoading(true);
    if (isGAS()) {
      setIsSandboxMode(false);
      try {
        const promiseClients = runGASPromise<Client[]>("getClients");
        const promiseSchedule = runGASPromise<ScheduleSlot[]>("getSchedule");
        const promisePrices = runGASPromise<Price[]>("getPrices");
        const promiseSubs = runGASPromise<Subscription[]>("getSubscriptions");
        const promiseAttendance = runGASPromise<AttendanceRecord[]>("getAttendanceRecords");
        const promisePersonal = runGASPromise<PersonalLesson[]>("getPersonalLessons");

        const [c, s, p, sub, att, pers] = await Promise.all([
          promiseClients,
          promiseSchedule,
          promisePrices,
          promiseSubs,
          promiseAttendance,
          promisePersonal
        ]);

        setClients(c || []);
        setSchedule(s || []);
        setPrices(p || []);
        setSubscriptions(sub || []);
        setAttendance(att || []);
        setPersonalLessons(pers || []);
      } catch (err) {
        console.error("Failed to load GAS database, dropping back to offline simulate mode", err);
        setIsSandboxMode(true);
        loadDefaultLocalStorage();
      } finally {
        setLoading(false);
      }
    } else {
      setIsSandboxMode(true);
      loadDefaultLocalStorage();
      setLoading(false);
    }
  }, []);

  const loadDefaultLocalStorage = () => {
    // Check localStorage, if empty set defaults
    const localClients = localStorage.getItem("tangodb_clients");
    const localSchedule = localStorage.getItem("tangodb_schedule");
    const localPrices = localStorage.getItem("tangodb_prices");
    const localSubs = localStorage.getItem("tangodb_subscriptions");
    const localAtt = localStorage.getItem("tangodb_attendance");
    const localPersonal = localStorage.getItem("tangodb_personal");

    if (!localClients) {
      localStorage.setItem("tangodb_clients", JSON.stringify(DEFAULT_CLIENTS));
      localStorage.setItem("tangodb_schedule", JSON.stringify(DEFAULT_SCHEDULE));
      localStorage.setItem("tangodb_prices", JSON.stringify(DEFAULT_PRICES));
      localStorage.setItem("tangodb_subscriptions", JSON.stringify(DEFAULT_SUBSCRIPTIONS));
      localStorage.setItem("tangodb_attendance", JSON.stringify(DEFAULT_ATTENDANCE));
      localStorage.setItem("tangodb_personal", JSON.stringify(DEFAULT_PERSONAL_LESSONS));

      setClients(DEFAULT_CLIENTS);
      setSchedule(DEFAULT_SCHEDULE);
      setPrices(DEFAULT_PRICES);
      setSubscriptions(DEFAULT_SUBSCRIPTIONS);
      setAttendance(DEFAULT_ATTENDANCE);
      setPersonalLessons(DEFAULT_PERSONAL_LESSONS);
    } else {
      setClients(JSON.parse(localClients));
      setSchedule(JSON.parse(localSchedule || "[]"));
      setPrices(JSON.parse(localPrices || "[]"));
      setSubscriptions(JSON.parse(localSubs || "[]"));
      setAttendance(JSON.parse(localAtt || "[]"));
      setPersonalLessons(JSON.parse(localPersonal || "[]"));
    }
  };

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Save changes to LocalStorage if in Sandbox mode
  const syncLocal = (key: string, data: any) => {
    if (!isGAS()) {
      localStorage.setItem(key, JSON.stringify(data));
    }
  };

  // ══════════════════════════════════════
  //  CLIENTS MUTATIONS
  // ══════════════════════════════════════

  const addClient = async (firstName: string, lastName: string, telegram: string): Promise<{ success: boolean; id?: string; error?: string }> => {
    const fTrim = firstName.trim();
    const lTrim = lastName.trim();
    const tTrim = telegram.trim();

    // Check duplicate
    const exists = clients.some(
      c => c.firstName.toLowerCase() === fTrim.toLowerCase() && c.lastName.toLowerCase() === lTrim.toLowerCase()
    );

    if (exists) {
      return { success: false, error: "Клиент с таким именем и фамилией уже существует" };
    }

    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; id?: string; error?: string }>("addClient", fTrim, lTrim, tTrim);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message || "Ошибка сервера" };
      }
    } else {
      const id = (Date.now() + Math.floor(Math.random() * 1000)).toString();
      const newClient: Client = { id, firstName: fTrim, lastName: lTrim, telegram: tTrim };
      const updated = [...clients, newClient];
      setClients(updated);
      syncLocal("tangodb_clients", updated);
      return { success: true, id };
    }
  };

  const updateClient = async (clientId: string, firstName: string, lastName: string, telegram: string): Promise<{ success: boolean; error?: string }> => {
    const fTrim = firstName.trim();
    const lTrim = lastName.trim();
    const tTrim = telegram.trim();

    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("updateClient", clientId, fTrim, lTrim, tTrim);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message || "Ошибка сервера" };
      }
    } else {
      const updated = clients.map(c => (c.id === clientId ? { ...c, firstName: fTrim, lastName: lTrim, telegram: tTrim } : c));
      setClients(updated);
      syncLocal("tangodb_clients", updated);
      return { success: true };
    }
  };

  const deleteClient = async (clientId: string): Promise<{ success: boolean; error?: string }> => {
    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("deleteClient", clientId);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message || "Ошибка сервера" };
      }
    } else {
      const updated = clients.filter(c => c.id !== clientId);
      setClients(updated);
      syncLocal("tangodb_clients", updated);
      return { success: true };
    }
  };

  // ══════════════════════════════════════
  //  SCHEDULE MUTATIONS
  // ══════════════════════════════════════

  const addScheduleSlot = async (dayOfWeek: number, time: string): Promise<{ success: boolean; error?: string }> => {
    // Check duplicate
    const exists = schedule.some(s => s.dayOfWeek.toString() === dayOfWeek.toString() && s.time === time);
    if (exists) {
      return { success: false, error: "Такой день и время уже есть в расписании" };
    }

    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("addScheduleSlot", dayOfWeek, time);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message || "Ошибка" };
      }
    } else {
      const updated = [...schedule, { dayOfWeek, time }].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.time.localeCompare(b.time));
      setSchedule(updated);
      syncLocal("tangodb_schedule", updated);
      return { success: true };
    }
  };

  const deleteScheduleSlot = async (dayOfWeek: number, time: string): Promise<{ success: boolean; error?: string }> => {
    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("deleteScheduleSlot", dayOfWeek, time);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message || "Ошибка" };
      }
    } else {
      const updated = schedule.filter(s => !(s.dayOfWeek === dayOfWeek && s.time === time));
      setSchedule(updated);
      syncLocal("tangodb_schedule", updated);
      return { success: true };
    }
  };

  // ══════════════════════════════════════
  //  PRICES MUTATIONS
  // ══════════════════════════════════════

  const updatePrice = async (rowIndex: number, newPrice: number): Promise<{ success: boolean; error?: string }> => {
    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("updatePrice", rowIndex, newPrice);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else {
      const updated = prices.map(p => (p.row === rowIndex ? { ...p, price: newPrice } : p));
      setPrices(updated);
      syncLocal("tangodb_prices", updated);
      return { success: true };
    }
  };

  // ══════════════════════════════════════
  //  SUBSCRIPTIONS MUTATIONS
  // ══════════════════════════════════════

  const addSubscription = async (sub: {
    type: string;
    clientId1: string;
    clientId2: string;
    lessonsTotal: number;
    activationDate: string;
    pairMonth: number | "";
  }): Promise<{ success: boolean; id?: string; error?: string }> => {
    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; id?: string; error?: string }>("addSubscription", sub);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else {
      const id = "sub-" + Date.now();
      const newSub: Subscription = {
        id,
        type: sub.type,
        clientId1: sub.clientId1,
        clientId2: sub.clientId2,
        lessonsTotal: sub.lessonsTotal,
        lessonsLeft: sub.lessonsTotal, // initial left is equal to total
        freezeUsed: 0,
        activationDate: sub.activationDate,
        status: "active",
        pairMonth: sub.pairMonth
      };
      const updated = [...subscriptions, newSub];
      setSubscriptions(updated);
      syncLocal("tangodb_subscriptions", updated);
      return { success: true, id };
    }
  };

  const finishSubscription = async (subId: string): Promise<{ success: boolean; error?: string }> => {
    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("finishSubscription", subId);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else {
      const updated = subscriptions.map(s => (s.id === subId ? { ...s, status: "finished" } : s));
      setSubscriptions(updated);
      syncLocal("tangodb_subscriptions", updated);
      return { success: true };
    }
  };

  // ══════════════════════════════════════
  //  ATTENDANCE JOURNAL
  // ══════════════════════════════════════

  const getScheduleDatesForMonth = useCallback((yearMonth: string): { date: string; time: string }[] => {
    if (!schedule.length || !yearMonth) return [];
    
    const [yearStr, monthStr] = yearMonth.split("-");
    const year = parseInt(yearStr);
    const month = parseInt(monthStr);
    const daysInMonth = new Date(year, month, 0).getDate();
    const dates: { date: string; time: string }[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month - 1, day);
      const jsDay = date.getDay(); // 0 = sun, ..., 6 = sat
      const dow = jsDay === 0 ? 7 : jsDay; // 1 = mon, ..., 7 = sun

      schedule.forEach(slot => {
        if (slot.dayOfWeek === dow) {
          const dd = String(day).padStart(2, "0");
          const mm = String(month).padStart(2, "0");
          const dateStr = `${year}-${mm}-${dd}`;
          dates.push({ date: dateStr, time: slot.time });
        }
      });
    }

    return dates.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  }, [schedule]);

  const getSubsForDate = useCallback((dateStr: string) => {
    const clientMap: Record<string, Client> = {};
    clients.forEach(c => {
      clientMap[c.id] = c;
    });

    const activeSubs = subscriptions.filter(s => {
      if (s.status !== "active") return false;
      if (s.activationDate > dateStr) return false;
      if (s.lessonsLeft <= 0) return false;
      return true;
    });

    return activeSubs.map(s => {
      const c1 = clientMap[s.clientId1] || ({} as Client);
      const c2 = s.clientId2 ? clientMap[s.clientId2] : null;

      const existing = attendance.find(a => a.date === dateStr && a.subscriptionId === s.id);

      return {
        subId: s.id,
        type: s.type,
        client1: c1.lastName ? `${c1.lastName} ${c1.firstName}` : s.clientId1,
        client2: c2 && c2.lastName ? `${c2.lastName} ${c2.firstName}` : "",
        lessonsLeft: s.lessonsLeft,
        lessonsTotal: s.lessonsTotal,
        freezeUsed: s.freezeUsed,
        activationDate: s.activationDate,
        currentStatus: existing ? existing.attendanceStatus : null,
        canFreeze: s.lessonsTotal === 8 && s.freezeUsed === 0
      };
    });
  }, [clients, subscriptions, attendance]);

  const markAttendance = async (dateStr: string, subId: string, newStatus: "present" | "absent" | "freeze"): Promise<{ success: boolean; newLessonsLeft?: number; error?: string }> => {
    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; newLessonsLeft?: number; error?: string }>("markAttendance", dateStr, subId, newStatus);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else {
      // Find subscription logic locally
      const sub = subscriptions.find(s => s.id === subId);
      if (!sub) return { success: false, error: "Абонемент не найден" };

      const existingRecord = attendance.find(a => a.date === dateStr && a.subscriptionId === subId);
      const oldStatus = existingRecord ? existingRecord.attendanceStatus : null;

      if (oldStatus === newStatus) return { success: true, newLessonsLeft: sub.lessonsLeft };

      let lessonsLeftDelta = 0;
      let freezeDelta = 0;

      // Rollback old status in local count
      if (oldStatus === "present" || oldStatus === "absent") {
        lessonsLeftDelta += 1;
      }
      if (oldStatus === "freeze") {
        freezeDelta -= 1;
      }

      // Incorporate new status
      if (newStatus === "present" || newStatus === "absent") {
        lessonsLeftDelta -= 1;
      }
      if (newStatus === "freeze") {
        freezeDelta += 1;
      }

      // If change groups are the same (present <-> absent) no actual change in lessons count
      const wasDeducted = oldStatus === "present" || oldStatus === "absent";
      const nowDeducted = newStatus === "present" || newStatus === "absent";
      if (wasDeducted && nowDeducted) {
        lessonsLeftDelta = 0;
      }

      if (newStatus === "freeze") {
        if (sub.lessonsTotal !== 8) {
          return { success: false, error: "Заморозка доступна только для абонементов на 8 уроков" };
        }
        if (sub.freezeUsed + freezeDelta > 1) {
          return { success: false, error: "Заморозка по этому абонементу уже использована" };
        }
      }

      const nextLessonsCount = sub.lessonsLeft + lessonsLeftDelta;
      if (nextLessonsCount < 0) {
        return { success: false, error: "Недостаточно уроков в абонементе" };
      }

      const nextFreezeCount = sub.freezeUsed + freezeDelta;

      // Client strings for display in records
      const clientMap: Record<string, Client> = {};
      clients.forEach(c => { clientMap[c.id] = c; });
      const c1 = clientMap[sub.clientId1] || ({} as Client);
      const c2 = sub.clientId2 ? clientMap[sub.clientId2] : null;
      let clientDisplayStr = c1.lastName ? `${c1.lastName} ${c1.firstName}` : sub.clientId1;
      if (c2 && c2.lastName) {
        clientDisplayStr += ` & ${c2.lastName} ${c2.firstName}`;
      }

      // Update Subscription state
      const updatedSubs = subscriptions.map(s => {
        if (s.id === subId) {
          const nextStatus = nextLessonsCount === 0 ? "finished" : s.status;
          return {
            ...s,
            lessonsLeft: nextLessonsCount,
            freezeUsed: nextFreezeCount,
            status: nextStatus
          };
        }
        return s;
      });

      // Update Attendance state
      let updatedAttendance: AttendanceRecord[];
      if (!existingRecord) {
        updatedAttendance = [...attendance, {
          date: dateStr,
          subscriptionId: subId,
          clientDisplay: clientDisplayStr,
          attendanceStatus: newStatus
        }];
      } else {
        updatedAttendance = attendance.map(a =>
          a.date === dateStr && a.subscriptionId === subId ? { ...a, attendanceStatus: newStatus } : a
        );
      }

      setSubscriptions(updatedSubs);
      setAttendance(updatedAttendance);
      syncLocal("tangodb_subscriptions", updatedSubs);
      syncLocal("tangodb_attendance", updatedAttendance);

      return { success: true, newLessonsLeft: nextLessonsCount };
    }
  };

  // ══════════════════════════════════════
  //  PERSONAL LESSONS MUTATIONS
  // ══════════════════════════════════════

  const addPersonalLessons = async (lessons: {
    type: string;
    clientId1: string;
    clientId2: string;
    clientId3: string;
    dates: string[];
    price: number;
    paid: boolean;
  }): Promise<{ success: boolean; error?: string }> => {
    if (!lessons.dates.length) {
      return { success: false, error: "Нет дат для бронирования" };
    }

    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("addPersonalLessons", {
          ...lessons,
          paid: lessons.paid
        });
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else {
      const newItems: PersonalLesson[] = lessons.dates.map((dateStr, index) => {
        return {
          id: "p-" + (Date.now() + index),
          type: lessons.type,
          clientId1: lessons.clientId1,
          clientId2: lessons.clientId2,
          clientId3: lessons.clientId3,
          date: dateStr,
          price: lessons.price,
          paid: lessons.paid ? "yes" : "no",
          row: personalLessons.length + index + 2 // simulate row
        };
      });

      const updated = [...personalLessons, ...newItems];
      setPersonalLessons(updated);
      syncLocal("tangodb_personal", updated);
      return { success: true };
    }
  };

  const updatePersonalLessonPaid = async (rowIndex: number, paid: boolean, id?: string): Promise<{ success: boolean; error?: string }> => {
    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("updatePersonalLessonPaid", rowIndex, paid);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else {
      const updated = personalLessons.map(l => {
        const isTarget = id ? l.id === id : l.row === rowIndex;
        return isTarget ? { ...l, paid: paid ? "yes" as const : "no" as const } : l;
      });
      setPersonalLessons(updated);
      syncLocal("tangodb_personal", updated);
      return { success: true };
    }
  };

  const deletePersonalLessonRow = async (rowIndex: number, id?: string): Promise<{ success: boolean; error?: string }> => {
    if (isGAS()) {
      try {
        const res = await runGASPromise<{ success: boolean; error?: string }>("deletePersonalLessonRow", rowIndex);
        if (res.success) {
          loadData();
        }
        return res;
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    } else {
      const updated = personalLessons.filter(l => {
        return id ? l.id !== id : l.row !== rowIndex;
      });
      setPersonalLessons(updated);
      syncLocal("tangodb_personal", updated);
      return { success: true };
    }
  };

  return {
    clients,
    schedule,
    prices,
    subscriptions,
    attendance,
    personalLessons,
    loading,
    isSandboxMode,
    refreshData: loadData,
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
    deletePersonalLessonRow
  };
}
