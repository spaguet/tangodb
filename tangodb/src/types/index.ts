export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  telegram: string;
  createdAt?: string;
}

export interface Discipline {
  id: number;
  name: string;
  description: string;
  createdAt?: string;
}

export interface ScheduleSlot {
  id?: number;
  dayOfWeek: number;
  time: string;
  timeEnd: string;
  disciplineId?: number | null;
}

export type PriceCategory = "group" | "private";

export interface Price {
  id?: number;
  row?: number;
  type: string;
  lessons: number;
  price: number;
  label?: string;
  description?: string;
  category: PriceCategory;
}

export interface Subscription {
  id: string;
  type: "solo" | "pair" | "pair_hm" | string;
  clientId1: string;
  clientId2: string;
  lessonsTotal: number;
  lessonsLeft: number;
  freezeUsed: number;
  activationDate: string;
  status: "active" | "finished";
  pairMonth: string;
  disciplineId?: number | null;
}

export interface AttendanceRecord {
  id?: number;
  date: string;
  subscriptionId: string;
  clientDisplay: string;
  attendanceStatus: "present" | "absent" | "freeze";
}

export interface PersonalLesson {
  id: string;
  type: "solo" | "pair" | "trio" | string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  clientDisplay: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  price: number;
  paid: "yes" | "no";
  disciplineId?: number | null;
}

export interface ActiveSubscription {
  subId: string;
  type: string;
  pairMonth: string;
  client1: string;
  client2: string;
  client1tg: string;
  client2tg: string;
  lessonsTotal: number;
  lessonsLeft: number;
  freezeUsed: number;
  activationDate: string;
}

export interface SubForDate {
  subId: string;
  type: string;
  pairMonth: string;
  client1: string;
  client2: string;
  lessonsLeft: number;
  lessonsTotal: number;
  freezeUsed: number;
  activationDate: string;
  currentStatus: "present" | "absent" | "freeze" | null;
  canFreeze: boolean;
}
