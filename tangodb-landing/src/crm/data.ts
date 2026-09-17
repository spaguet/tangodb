import type { Locale } from "../i18n";
import { getMondayOfWeek } from "./demoDates";

export function formatMoney(n: number, locale: Locale = "ru") {
  return new Intl.NumberFormat(locale === "ru" ? "ru-RU" : "en-US", {
    style: "currency",
    currency: locale === "ru" ? "RUB" : "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

/** @deprecated use formatMoney */
export const formatEuro = formatMoney;

export const STUDIO_NAME = "Студия Ритм";
export const STUDIO_LOCATION = "Зал A";

export const financialStats = {
  revenue: 123_324,
  mom: null as number | null,
  paymentCount: 31,
  subscriptions: 8_500,
  personal: 114_524,
  singleVisits: 300,
  receivables: 0,
  receivablesSubs: 0,
  receivablesPersonal: 0,
  expenses: 0,
  payroll: 12_132,
  profit: 111_192,
  newClients: 7,
  occupancy: 87,
  occupancyPresent: 142,
  occupancyAbsent: 28,
} as const;

export const paymentByMethod = [
  { methodRu: "Карта", methodEn: "Card", amount: 4_000 },
  { methodRu: "Наличные", methodEn: "Cash", amount: 0 },
  { methodRu: "Перевод", methodEn: "Transfer", amount: 0 },
] as const;

export const revenueSplit = [
  { key: "subscription", label: "Subscriptions", amount: 8200, pct: 66 },
  { key: "personal", label: "Private lessons", amount: 2890, pct: 23 },
  { key: "single_visit", label: "Drop-in visits", amount: 1390, pct: 11 },
] as const;

export const revenueTrend = [8200, 9100, 8800, 10200, 11100, 12480] as const;

export const topTeachers = [
  { name: "Мария Лопес", amount: 4820 },
  { name: "Пётр Рузин", amount: 3910 },
  { name: "Ана Петрова", amount: 2750 },
] as const;

export const topClients = [
  { name: "Алексей и Мария Козловы", amount: 420 },
  { name: "Анастасия Морозова", amount: 385 },
  { name: "Елена Смирнова", amount: 290 },
] as const;

export const activeSubsSummary = { total: 24, solos: 16, pairs: 8 };
export const unpaidPersonal = { count: 2, amount: 115 };

export const expiringSubs = [
  { client: "Лука Романов", left: 1, total: 4, discipline: "Сальса" },
  { client: "Марта Сёмина", left: 2, total: 8, discipline: "Бачата" },
] as const;

export const todayPayments = [
  { client: "Елена Смирнова", source: "Абонемент", method: "Карта", amount: 120 },
  { client: "Дмитрий Фёдоров", source: "Разовое", method: "Наличные", amount: 15 },
] as const;

export const attendanceMonthStats = { present: 142, absent: 28, freeze: 4 };

const scheduleLessonTemplates = [
  { day: 1, title: "Сальса", subtitle: "Мария Лопес", start: "18:00", end: "19:00", kind: "group" as const },
  { day: 1, title: "Бачата", subtitle: "Пётр Рузин", start: "19:30", end: "20:30", kind: "group" as const },
  { day: 2, title: "Танго", subtitle: "Ана Петрова", start: "17:00", end: "18:00", kind: "group" as const },
  { day: 3, title: "Сальса", subtitle: "Мария Лопес", start: "18:30", end: "19:30", kind: "group" as const },
  { day: 4, title: "Бачата", subtitle: "Пётр Рузин", start: "19:00", end: "20:00", kind: "group" as const },
  { day: 5, title: "Танго", subtitle: "Ана Петрова", start: "18:00", end: "19:00", kind: "group" as const },
  { day: 6, title: "Сальса", subtitle: "Мария Лопес", start: "11:00", end: "12:00", kind: "group" as const },
  { day: 3, title: "Персональный", subtitle: "Елена Смирнова", start: "14:00", end: "15:00", kind: "personal" as const },
] as const;

export type DemoScheduleLesson = (typeof scheduleLessonTemplates)[number] & { dayNum: number };

export function getScheduleLessons(): DemoScheduleLesson[] {
  const monday = getMondayOfWeek();
  return scheduleLessonTemplates.map((lesson) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + (lesson.day - 1));
    return { ...lesson, dayNum: date.getDate() };
  });
}

export const attendanceStudents = [
  { name: "Елена Смирнова", status: "present" as const, sub: "Соло · осталось 3" },
  { name: "Лука Романов", status: "present" as const, sub: "Соло · осталось 1" },
  { name: "Анастасия Морозова", status: "absent" as const, sub: "Соло · осталось 8" },
  { name: "Алексей и Мария Козловы", status: "present" as const, sub: "Пара · осталось 6" },
  { name: "Павел и Полина Рудь", status: "freeze" as const, sub: "Пара · осталось 4" },
  { name: "Марта Сёмина", status: "present" as const, sub: "Соло · осталось 2" },
  { name: "Дмитрий Фёдоров", status: "absent" as const, sub: "Соло · осталось 5" },
] as const;

export const subscriptionGroups = [
  {
    discipline: "Сальса",
    subs: [
      {
        id: "s1",
        client: "Елена Смирнова",
        tariff: "Solo · 8 classes",
        left: 3,
        total: 8,
        groups: ["Mon 18:00", "Wed 18:30"],
        activated: "2026-04-10",
        visits: 5,
        absences: 0,
        freezeAvailable: true,
      },
      {
        id: "s2",
        client: "Анастасия Морозова",
        tariff: "Solo · 8 classes",
        left: 8,
        total: 8,
        groups: ["Wed 18:30"],
        activated: "2026-06-28",
        visits: 0,
        absences: 0,
        freezeAvailable: true,
      },
    ],
  },
  {
    discipline: "Бачата",
    subs: [
      {
        id: "s3",
        client: "Алексей и Мария Козловы",
        tariff: "Pair · 12 classes",
        left: 6,
        total: 12,
        groups: ["Thu 19:00"],
        activated: "2026-03-15",
        visits: 6,
        absences: 1,
        freezeAvailable: false,
      },
    ],
  },
  {
    discipline: "Аргентинское танго",
    subs: [
      {
        id: "s4",
        client: "Лука Романов",
        tariff: "Solo · 4 classes",
        left: 1,
        total: 4,
        groups: ["Tue 17:00"],
        activated: "2026-06-01",
        visits: 3,
        absences: 0,
        freezeAvailable: false,
        alarm: true,
      },
    ],
  },
] as const;

export const subscriptionHistory = [
  {
    client: "Пётр Аносов",
    tariff: "Solo · 8 classes",
    discipline: "Сальса",
    activated: "2026-01-12",
    left: 0,
    total: 8,
    finished: true,
  },
  {
    client: "Марта Сёмина",
    tariff: "Solo · 4 classes",
    discipline: "Бачата",
    activated: "2026-02-20",
    left: 2,
    total: 4,
    finished: false,
  },
] as const;

export const subscriptions = [
  { client: "Елена Смирнова", type: "Соло · 8 занятий", discipline: "Сальса", left: 3, total: 8, groups: "Пн 18:00" },
  { client: "Алексей и Мария Козловы", type: "Пара · 12 занятий", discipline: "Бачата", left: 6, total: 12, groups: "Чт 19:00" },
  { client: "Лука Романов", type: "Соло · 4 занятия", discipline: "Танго", left: 1, total: 4, groups: "Вт 17:00" },
  { client: "Анастасия Морозова", type: "Соло · 8 занятий", discipline: "Сальса", left: 8, total: 8, groups: "Ср 18:30" },
] as const;

export type DemoPersonalLesson = {
  id: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  clientDisplay: string;
  teacher: string;
  discipline: string;
  location: string;
  type: "solo" | "pair";
  paid: "yes" | "no";
  attendance: "present" | "absent" | null;
  price: number;
};

export const personalLessons: DemoPersonalLesson[] = [
  {
    id: "p1",
    date: "2026-06-30",
    timeStart: "14:00",
    timeEnd: "15:00",
    clientDisplay: "Елена Смирнова",
    teacher: "Мария Лопес",
    discipline: "Сальса",
    location: "Зал A",
    type: "solo",
    paid: "yes",
    attendance: "present",
    price: 45,
  },
  {
    id: "p2",
    date: "2026-07-01",
    timeStart: "16:30",
    timeEnd: "17:30",
    clientDisplay: "Алексей и Мария Козловы",
    teacher: "Пётр Рузин",
    discipline: "Бачата",
    location: "Зал A",
    type: "pair",
    paid: "no",
    attendance: null,
    price: 70,
  },
  {
    id: "p3",
    date: "2026-06-28",
    timeStart: "11:00",
    timeEnd: "12:00",
    clientDisplay: "Лука Романов",
    teacher: "Ана Петрова",
    discipline: "Аргентинское танго",
    location: "Зал B",
    type: "solo",
    paid: "yes",
    attendance: "present",
    price: 50,
  },
  {
    id: "p4",
    date: "2026-07-03",
    timeStart: "18:00",
    timeEnd: "19:00",
    clientDisplay: "Анастасия Морозова",
    teacher: "Мария Лопес",
    discipline: "Сальса",
    location: "Зал A",
    type: "solo",
    paid: "no",
    attendance: null,
    price: 45,
  },
];

export const sellForm = {
  client: "Анастасия Морозова",
  client2: "",
  discipline: "Сальса",
  tariff: "Соло · 8 занятий",
  price: 120,
  activation: "2026-07-01",
  payment: "Карта",
  groups: "Пн 18:00, Ср 18:30",
  localPriceList: false,
  location: "Зал A",
} as const;

export const dowShort = { en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] } as const;

export type DemoClient = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  telegram: string;
  isMinor: boolean;
  note?: string;
};

export const demoClients: DemoClient[] = [
  { id: "1", firstName: "Елена", lastName: "Смирнова", phone: "+7 912 345 67 89", email: "elena@example.ru", telegram: "https://t.me/elena_demo", isMinor: false, note: "Любит первый ряд" },
  { id: "2", firstName: "Алексей", lastName: "Козлов", phone: "+7 916 112 23 34", email: "alex@example.ru", telegram: "https://t.me/alex_demo", isMinor: false },
  { id: "3", firstName: "Мария", lastName: "Козлова", phone: "+7 916 112 23 35", email: "maria@example.ru", telegram: "", isMinor: false },
  { id: "4", firstName: "Лука", lastName: "Романов", phone: "+7 903 887 12 00", email: "", telegram: "https://t.me/luka_demo", isMinor: false },
  { id: "5", firstName: "Анастасия", lastName: "Морозова", phone: "+7 911 440 99 22", email: "nastya@example.ru", telegram: "https://t.me/nastya_demo", isMinor: false },
  { id: "6", firstName: "Марта", lastName: "Сёмина", phone: "+7 900 221 88 99", email: "", telegram: "", isMinor: false },
];

export const archivedClients = [
  { id: "a1", firstName: "Пётр", lastName: "Аносов", archivedAt: "2026-05-12" },
] as const;

export const paymentJournal = [
  { client: "Елена Смирнова", date: "30 сен., 14:22", source: "Абонемент", method: "Карта", amount: 120 },
  { client: "Алексей и Мария Козловы", date: "29 сен., 11:05", source: "Персональный", method: "Перевод", amount: 70 },
  { client: "Дмитрий Фёдоров", date: "30 сен., 18:41", source: "Разовое", method: "Наличные", amount: 15 },
  { client: "Анастасия Морозова", date: "28 сен., 09:15", source: "Абонемент", method: "Карта", amount: 165 },
  { client: "Лука Романов", date: "27 сен., 16:50", source: "Персональный", method: "Карта", amount: 50 },
] as const;

export const debtors = [
  { client: "Алексей и Мария Козловы", contact: "@alex_demo", detail: "Персональный · 1 окт · 16:30", amount: 70 },
  { client: "Анастасия Морозова", contact: "@nastya_demo", detail: "Персональный · 3 окт · 18:00", amount: 45 },
  { client: "Лука Романов", contact: "@luka_demo", detail: "Абонемент · осталось 1 занятие", amount: 0 },
] as const;

export const expenses = [
  { description: "Аренда зала", category: "Аренда", date: "1 сен.", amount: 1800 },
  { description: "Реклама в соцсетях", category: "Маркетинг", date: "8 сен.", amount: 250 },
  { description: "Хозтовары", category: "Расходники", date: "15 сен.", amount: 85 },
] as const;

export const payrollRows = [
  { name: "Мария Лопес", role: "Преподаватель", accrued: 1680, paid: 1200, balance: 480 },
  { name: "Пётр Рузин", role: "Преподаватель", accrued: 1420, paid: 1420, balance: 0 },
  { name: "Ана Петрова", role: "Преподаватель", accrued: 1000, paid: 800, balance: 200 },
] as const;

export const priceTariffs = {
  group: [
    { title: "Solo · 8 classes", desc: "Group · Salsa", price: 120, meta: "Global tariff" },
    { title: "Solo · 12 classes", desc: "Group · Bachata", price: 165, meta: "Global tariff" },
    { title: "Pair · 8 classes", desc: "Group · Salsa", price: 200, meta: "Global tariff" },
    { title: "Pair · 12 classes", desc: "Group · Bachata", price: 270, meta: "Global tariff" },
  ],
  privateLesson: [
    { title: "Private solo · 60 min", desc: "Single lesson", price: 45, meta: "Hall A" },
    { title: "Private pair · 60 min", desc: "Single lesson", price: 70, meta: "Hall A" },
  ],
  privatePackage: [
    { title: "Package solo · 4 lessons", desc: "Private package", price: 170, meta: "Global tariff" },
  ],
  singleVisit: [
    { title: "Drop-in group class", desc: "Single visit", price: 15, meta: "Global tariff" },
  ],
} as const;

export const disciplines = ["Сальса", "Бачата", "Аргентинское танго"] as const;
export const locations = [
  { name: "Зал A", address: "ул. Примерная, 12, Москва" },
  { name: "Зал B", address: "ул. Примерная, 12, Москва" },
] as const;

export const teamMembers = [
  { name: "Ана Петрова", role: "Владелец", since: "янв. 2024" },
  { name: "Мария Лопес", role: "Преподаватель", since: "мар. 2024" },
  { name: "Пётр Рузин", role: "Преподаватель", since: "апр. 2024" },
  { name: "Лаура Мартынова", role: "Администратор", since: "июн. 2024" },
] as const;

export const pendingInvites = [
  { name: "Дмитрий Фёдоров", email: "dmitry@example.ru", role: "Преподаватель", expires: "7 окт." },
] as const;

export const personalSellForm = {
  client: "Елена Смирнова",
  teacher: "Мария Лопес",
  location: "Зал A",
  discipline: "Сальса",
  date: "2026-07-05",
  timeStart: "14:00",
  timeEnd: "15:00",
  tariff: "Персональное соло · 60 мин",
  price: 45,
  payment: "Карта",
} as const;

export const settingsGeneral = {
  locale: "Русский",
  currency: "RUB",
  currencyDisplay: "Символ (₽)",
  timezone: "Europe/Moscow",
  weekStart: "Понедельник",
  branding: "Студия Ритм",
} as const;
