export const formatEuro = (n: number) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export const STUDIO_NAME = "Studio Ritmo";
export const STUDIO_LOCATION = "Hall A";

export const financialStats = {
  revenue: 12480,
  mom: 12,
  paymentCount: 38,
  subscriptions: 8200,
  personal: 2890,
  singleVisits: 1390,
  receivables: 1150,
  receivablesSubs: 1,
  receivablesPersonal: 2,
  expenses: 3200,
  payroll: 4100,
  profit: 5180,
  newClients: 7,
  occupancy: 87,
  occupancyPresent: 142,
  occupancyAbsent: 28,
} as const;

export const paymentByMethod = [
  { method: "Card", amount: 6420 },
  { method: "Cash", amount: 3180 },
  { method: "Transfer", amount: 2880 },
] as const;

export const revenueSplit = [
  { key: "subscription", label: "Subscriptions", amount: 8200, pct: 66 },
  { key: "personal", label: "Private lessons", amount: 2890, pct: 23 },
  { key: "single_visit", label: "Drop-in visits", amount: 1390, pct: 11 },
] as const;

export const revenueTrend = [8200, 9100, 8800, 10200, 11100, 12480] as const;

export const topTeachers = [
  { name: "Maria López", amount: 4820 },
  { name: "Carlos Ruiz", amount: 3910 },
  { name: "Ana Petrova", amount: 2750 },
] as const;

export const topClients = [
  { name: "James & Sophie Chen", amount: 420 },
  { name: "Isabella Morales", amount: 385 },
  { name: "Elena Vasquez", amount: 290 },
] as const;

export const activeSubsSummary = { total: 24, solos: 16, pairs: 8 };
export const unpaidPersonal = { count: 2, amount: 115 };

export const expiringSubs = [
  { client: "Luca Romano", left: 1, total: 4, discipline: "Salsa" },
  { client: "Marta Gómez", left: 2, total: 8, discipline: "Bachata" },
] as const;

export const todayPayments = [
  { client: "Elena Vasquez", source: "Subscription", method: "Card", amount: 120 },
  { client: "Diego Fernández", source: "Drop-in", method: "Cash", amount: 15 },
] as const;

export const attendanceMonthStats = { present: 142, absent: 28, freeze: 4 };

export const scheduleLessons = [
  { day: 1, dayNum: 23, title: "Salsa", subtitle: "Maria López", start: "18:00", end: "19:00", kind: "group" as const },
  { day: 1, dayNum: 23, title: "Bachata", subtitle: "Carlos Ruiz", start: "19:30", end: "20:30", kind: "group" as const },
  { day: 2, dayNum: 24, title: "Tango", subtitle: "Ana Petrova", start: "17:00", end: "18:00", kind: "group" as const },
  { day: 3, dayNum: 25, title: "Salsa", subtitle: "Maria López", start: "18:30", end: "19:30", kind: "group" as const },
  { day: 4, dayNum: 26, title: "Bachata", subtitle: "Carlos Ruiz", start: "19:00", end: "20:00", kind: "group" as const },
  { day: 5, dayNum: 27, title: "Tango", subtitle: "Ana Petrova", start: "18:00", end: "19:00", kind: "group" as const },
  { day: 6, dayNum: 28, title: "Salsa", subtitle: "Maria López", start: "11:00", end: "12:00", kind: "group" as const },
  { day: 3, dayNum: 25, title: "Private", subtitle: "Elena Vasquez", start: "14:00", end: "15:00", kind: "personal" as const },
] as const;

export const attendanceStudents = [
  { name: "Elena Vasquez", status: "present" as const, sub: "Solo · 3 left" },
  { name: "Luca Romano", status: "present" as const, sub: "Solo · 1 left" },
  { name: "Isabella Morales", status: "absent" as const, sub: "Solo · 8 left" },
  { name: "James & Sophie Chen", status: "present" as const, sub: "Pair · 6 left" },
  { name: "Tomás & Paula Ruiz", status: "freeze" as const, sub: "Pair · 4 left" },
  { name: "Marta Gómez", status: "present" as const, sub: "Solo · 2 left" },
  { name: "Diego Fernández", status: "absent" as const, sub: "Solo · 5 left" },
] as const;

export const subscriptionGroups = [
  {
    discipline: "Salsa",
    subs: [
      {
        id: "s1",
        client: "Elena Vasquez",
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
        client: "Isabella Morales",
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
    discipline: "Bachata",
    subs: [
      {
        id: "s3",
        client: "James & Sophie Chen",
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
    discipline: "Argentine Tango",
    subs: [
      {
        id: "s4",
        client: "Luca Romano",
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
    client: "Pedro Alonso",
    tariff: "Solo · 8 classes",
    discipline: "Salsa",
    activated: "2026-01-12",
    left: 0,
    total: 8,
    finished: true,
  },
  {
    client: "Marta Gómez",
    tariff: "Solo · 4 classes",
    discipline: "Bachata",
    activated: "2026-02-20",
    left: 2,
    total: 4,
    finished: false,
  },
] as const;

export const subscriptions = [
  { client: "Elena Vasquez", type: "Solo · 8 classes", discipline: "Salsa", left: 3, total: 8, groups: "Mon 18:00" },
  { client: "James & Sophie Chen", type: "Pair · 12 classes", discipline: "Bachata", left: 6, total: 12, groups: "Thu 19:00" },
  { client: "Luca Romano", type: "Solo · 4 classes", discipline: "Tango", left: 1, total: 4, groups: "Tue 17:00" },
  { client: "Isabella Morales", type: "Solo · 8 classes", discipline: "Salsa", left: 8, total: 8, groups: "Wed 18:30" },
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
    clientDisplay: "Elena Vasquez",
    teacher: "Maria López",
    discipline: "Salsa",
    location: "Hall A",
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
    clientDisplay: "James & Sophie Chen",
    teacher: "Carlos Ruiz",
    discipline: "Bachata",
    location: "Hall A",
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
    clientDisplay: "Luca Romano",
    teacher: "Ana Petrova",
    discipline: "Argentine Tango",
    location: "Hall B",
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
    clientDisplay: "Isabella Morales",
    teacher: "Maria López",
    discipline: "Salsa",
    location: "Hall A",
    type: "solo",
    paid: "no",
    attendance: null,
    price: 45,
  },
];

export const sellForm = {
  client: "Isabella Morales",
  client2: "",
  discipline: "Salsa",
  tariff: "Solo · 8 classes",
  price: 120,
  activation: "2026-07-01",
  payment: "Card",
  groups: "Mon 18:00, Wed 18:30",
  localPriceList: false,
  location: "Hall A",
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
  { id: "1", firstName: "Elena", lastName: "Vasquez", phone: "+34 612 345 678", email: "elena@email.com", telegram: "https://t.me/elena_v", isMinor: false, note: "Prefers front row" },
  { id: "2", firstName: "James", lastName: "Chen", phone: "+34 698 112 233", email: "james@email.com", telegram: "https://t.me/jchen", isMinor: false },
  { id: "3", firstName: "Sophie", lastName: "Chen", phone: "+34 698 112 234", email: "sophie@email.com", telegram: "", isMinor: false },
  { id: "4", firstName: "Luca", lastName: "Romano", phone: "+34 655 887 120", email: "", telegram: "https://t.me/lucar", isMinor: false },
  { id: "5", firstName: "Isabella", lastName: "Morales", phone: "+34 611 440 992", email: "isa@email.com", telegram: "https://t.me/isa_m", isMinor: false },
  { id: "6", firstName: "Marta", lastName: "Gómez", phone: "+34 600 221 889", email: "", telegram: "", isMinor: false },
];

export const archivedClients = [
  { id: "a1", firstName: "Pedro", lastName: "Alonso", archivedAt: "2026-05-12" },
] as const;

export const paymentJournal = [
  { client: "Elena Vasquez", date: "Jun 30, 14:22", source: "Subscription", method: "Card", amount: 120 },
  { client: "James & Sophie Chen", date: "Jun 29, 11:05", source: "Private lesson", method: "Transfer", amount: 70 },
  { client: "Diego Fernández", date: "Jun 30, 18:41", source: "Drop-in", method: "Cash", amount: 15 },
  { client: "Isabella Morales", date: "Jun 28, 09:15", source: "Subscription", method: "Card", amount: 165 },
  { client: "Luca Romano", date: "Jun 27, 16:50", source: "Private lesson", method: "Card", amount: 50 },
] as const;

export const debtors = [
  { client: "James & Sophie Chen", contact: "@jchen", detail: "Private · Jul 1 · 16:30", amount: 70 },
  { client: "Isabella Morales", contact: "@isa_m", detail: "Private · Jul 3 · 18:00", amount: 45 },
  { client: "Luca Romano", contact: "@lucar", detail: "Subscription · 1 lesson left", amount: 0 },
] as const;

export const expenses = [
  { description: "Studio rent — June", category: "Rent", date: "Jun 1", amount: 1800 },
  { description: "Social media ads", category: "Marketing", date: "Jun 8", amount: 250 },
  { description: "Cleaning supplies", category: "Supplies", date: "Jun 15", amount: 85 },
] as const;

export const payrollRows = [
  { name: "Maria López", role: "Teacher", accrued: 1680, paid: 1200, balance: 480 },
  { name: "Carlos Ruiz", role: "Teacher", accrued: 1420, paid: 1420, balance: 0 },
  { name: "Ana Petrova", role: "Teacher", accrued: 1000, paid: 800, balance: 200 },
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

export const disciplines = ["Salsa", "Bachata", "Argentine Tango"] as const;
export const locations = [
  { name: "Hall A", address: "Calle Mayor 12, Madrid" },
  { name: "Hall B", address: "Calle Mayor 12, Madrid" },
] as const;

export const teamMembers = [
  { name: "Ana Petrova", role: "Owner", since: "Jan 2024" },
  { name: "Maria López", role: "Teacher", since: "Mar 2024" },
  { name: "Carlos Ruiz", role: "Teacher", since: "Apr 2024" },
  { name: "Laura Martín", role: "Administrator", since: "Jun 2024" },
] as const;

export const pendingInvites = [
  { name: "Diego Fernández", email: "diego@email.com", role: "Teacher", expires: "Jul 7" },
] as const;

export const personalSellForm = {
  client: "Elena Vasquez",
  teacher: "Maria López",
  location: "Hall A",
  discipline: "Salsa",
  date: "2026-07-05",
  timeStart: "14:00",
  timeEnd: "15:00",
  tariff: "Private solo · 60 min",
  price: 45,
  payment: "Card",
} as const;

export const settingsGeneral = {
  locale: "English",
  currency: "EUR",
  currencyDisplay: "Symbol (€)",
  timezone: "Europe/Madrid",
  weekStart: "Monday",
  branding: "Studio Ritmo",
} as const;
