export interface Client {
  id: string;
  firstName: string;
  lastName: string;
  telegram: string;
  phone: string;
  email: string;
  isMinor: boolean;
  guardian1Name: string;
  guardian1Phone: string;
  guardian1Telegram: string;
  guardian1Address: string;
  guardian2Name: string;
  guardian2Phone: string;
  guardian2Telegram: string;
  guardian2Address: string;
  createdAt?: string;
  archivedAt?: string | null;
}

export interface ClientNote {
  id: string;
  clientId: string;
  authorMemberId: string;
  authorDisplayName: string;
  authorRole: string;
  body: string;
  createdAt: string;
}

export interface Discipline {
  id: string;
  name: string;
  description: string;
  createdAt?: string;
}

export type BillingModel = "lesson_count" | "monthly_unlimited";

export interface ScheduleGroup {
  id: string;
  name: string;
  disciplineId: string;
  locationId: string | null;
}

export interface ScheduleSlot {
  id?: string;
  dayOfWeek: number;
  time: string;
  timeEnd: string;
  disciplineId?: string | null;
  groupName?: string;
  scheduleGroupId?: string | null;
  locationId?: string | null;
  teacherMemberId?: string | null;
  validFrom: string;
  validTo: string | null;
}

export interface GroupDisplayLesson {
  kind: "group";
  slotId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  validFrom: string;
  validTo: string | null;
  dayOfWeek: number;
  disciplineId: string | null;
  groupName?: string;
  scheduleGroupId: string | null;
  locationId: string | null;
  teacherMemberId: string | null;
}

export interface PersonalDisplayLesson {
  kind: "personal";
  lessonId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  paid: "yes" | "no";
  disciplineId: string | null;
  locationId: string | null;
  teacherMemberId: string | null;
  clientDisplay?: string;
}

export type DisplayLesson = GroupDisplayLesson | PersonalDisplayLesson;

export type PriceCategory = "group" | "private" | "single_visit";

export interface Price {
  id?: string;
  row?: number;
  type: string;
  lessons: number;
  price: number;
  label?: string;
  description?: string;
  category: PriceCategory;
  locationId?: string | null;
  disciplineId?: string | null;
  teacherMemberIds?: string[];
  billingModel?: BillingModel;
}

export interface SubscriptionGroupLink {
  scheduleGroupId: string;
}

export interface Subscription {
  id: string;
  type: "solo" | "pair" | "pair_hm" | string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  clientId4?: string;
  lessonsTotal: number;
  lessonsLeft: number;
  freezeUsed: number;
  activationDate: string;
  status: "active" | "finished";
  pairMonth: string;
  disciplineId?: string | null;
  priceId?: string | null;
  category: "group" | "private";
  billingModel: BillingModel;
  expiresAt?: string | null;
  groups?: SubscriptionGroupLink[];
}

export interface AttendanceRecord {
  id?: string;
  date: string;
  subscriptionId: string;
  scheduleGroupId: string;
  clientDisplay: string;
  attendanceStatus: "present" | "absent" | "freeze" | "excused";
}

export interface SingleVisit {
  id: string;
  visitDate: string;
  scheduleSlotId: string;
  scheduleGroupId: string;
  clientId: string;
  clientDisplay: string;
  priceId: string;
  amount: number;
  method: PaymentMethod;
  attendanceStatus: "present";
  locationId?: string | null;
  disciplineId?: string | null;
  teacherMemberId?: string | null;
  createdAt: string;
}

export interface PersonalLesson {
  id: string;
  type: "solo" | "pair" | "trio" | string;
  clientId1: string;
  clientId2: string;
  clientId3: string;
  clientId4?: string;
  clientDisplay: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  price: number;
  paid: "yes" | "no";
  disciplineId?: string | null;
  subscriptionId?: string | null;
  locationId?: string | null;
  teacherMemberId?: string | null;
  attendanceStatus?: "present" | "absent" | "excused" | null;
}

export type PaymentMethod = "cash" | "transfer" | "card" | "other";

export interface Payment {
  id: string;
  clientId: string;
  clientDisplay: string;
  amount: number;
  method: PaymentMethod;
  methodComment?: string | null;
  subscriptionId: string | null;
  personalLessonId: string | null;
  singleVisitId: string | null;
  createdAt: string;
}

export interface ActiveSubscription {
  subId: string;
  type: string;
  pairMonth: string;
  client1: string;
  client2: string;
  client3: string;
  client1tg: string;
  client2tg: string;
  client3tg: string;
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
  client3: string;
  lessonsLeft: number;
  lessonsTotal: number;
  freezeUsed: number;
  activationDate: string;
  billingModel: BillingModel;
  expiresAt?: string | null;
  daysLeft?: number;
  currentStatus: "present" | "absent" | "freeze" | "excused" | null;
  canFreeze: boolean;
  priceId?: string | null;
  category: "group" | "private";
}
