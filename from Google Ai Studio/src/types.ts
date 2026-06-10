/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  telegram: string;
}

export interface ScheduleSlot {
  dayOfWeek: number; // 1 = Mon, ..., 7 = Sun
  time: string;      // "HH:MM"
}

export interface Price {
  row: number;
  type: string;
  lessons: number;
  price: number;
}

export interface Subscription {
  id: string;
  type: "solo" | "pair" | "pair_hm" | string;
  clientId1: string;
  clientId2: string;
  lessonsTotal: number;
  lessonsLeft: number;
  freezeUsed: number; // 0 or 1
  activationDate: string; // "YYYY-MM-DD"
  status: "active" | "finished" | string;
  pairMonth: number | ""; // 1, 2, 3 or empty
}

export interface AttendanceRecord {
  date: string; // "YYYY-MM-DD"
  subscriptionId: string;
  clientDisplay: string;
  attendanceStatus: "present" | "absent" | "freeze" | string;
}

export interface PersonalLesson {
  id: string;
  type: "solo" | "pair" | "trio" | string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  date: string; // "YYYY-MM-DD"
  price: number;
  paid: "yes" | "no";
  row?: number; // Spreadsheets support row deletion
}

export interface GASConfig {
  webAppUrl: string;
  useLiveGAS: boolean;
}
