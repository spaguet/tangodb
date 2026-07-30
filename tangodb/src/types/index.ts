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
  category?: string | null;
  createdAt?: string;
}

export interface ConductedLessonReportRow {
  occurrenceId: string;
  slotId: string;
  scheduleGroupId: string | null;
  date: string;
  dayOfWeek: number;
  timeStart: string;
  timeEnd: string;
  disciplineCategory: string;
  disciplineId: string;
  disciplineName: string;
  groupName: string;
  teacherName: string;
  locationName: string;
  presentCount: number;
  absentCount: number;
  freezeCount: number;
}

export type BillingModel = "lesson_count" | "monthly_unlimited";

export interface ScheduleGroup {
  id: string;
  name: string;
  disciplineId: string;
  locationId: string | null;
  maxCapacity: number | null;
}

export type GroupWaitlistStatus = "waiting" | "offered" | "enrolled" | "declined" | "cancelled";

export interface GroupCapacitySnapshot {
  classId: string;
  maxCapacity: number | null;
  occupied: number;
  hasLimit: boolean;
  isFull: boolean;
}

export interface GroupWaitlistEntry {
  id: string;
  classId: string;
  clientId: string;
  status: GroupWaitlistStatus;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupSpotNotification {
  id: string;
  classId: string;
  waitlistEntryId: string;
  clientId: string;
  createdAt: string;
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
  movedFromSlotId?: string | null;
  movedFromDate?: string | null;
  movedFromTime?: string | null;
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
  movedFromSlotId?: string | null;
  movedFromDate?: string | null;
  movedFromTime?: string | null;
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

export type CalendarEventType = "master_class" | "open_lesson";

export type CalendarEventPaymentStatus = "unpaid" | "partial" | "paid";

export interface EventDisplayLesson {
  kind: "event";
  eventId: string;
  sessionId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  locationId: string | null;
  title: string;
  eventType: CalendarEventType;
  guestTeacher?: string | null;
  organizer?: string | null;
  comment?: string | null;
  paymentStatus?: CalendarEventPaymentStatus;
  incomeAmount?: number | null;
  paidAmount?: number | null;
  currency?: string;
  plannedGuestCount?: number | null;
  actualGuestCount?: number | null;
}

export type RentalPaymentStatus = "unpaid" | "partial" | "paid" | "overpaid";

export interface RentalDisplayLesson {
  kind: "rental";
  rentalId: string;
  date: string;
  timeStart: string;
  timeEnd: string;
  locationId: string | null;
  bookingStatus: "confirmed" | "cancelled";
  purpose?: string | null;
  renterName?: string | null;
  paymentStatus?: RentalPaymentStatus | null;
  fixedAmount?: number | null;
  paidAmount?: number | null;
  currency?: string;
}

export type DisplayLesson = GroupDisplayLesson | PersonalDisplayLesson | EventDisplayLesson | RentalDisplayLesson;

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
  freezeMaxCount?: number | null;
  freezeMinLessons?: number | null;
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

export type SubscriptionFreezePeriodStatus = "active" | "cancelled";

export type SubscriptionMemberChangeStatus = "scheduled" | "applied" | "cancelled";

export interface SubscriptionMemberChange {
  id: string;
  subscriptionId: string;
  memberSlot: number;
  outgoingClientId: string;
  incomingClientId: string;
  effectiveDate: string;
  status: SubscriptionMemberChangeStatus;
  reason?: string | null;
  createdAt: string;
  appliedAt?: string | null;
}

export interface SubscriptionFreezePeriod {
  id: string;
  subscriptionId: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
  status: SubscriptionFreezePeriodStatus;
  calendarDays: number;
  expiresDaysAdded: number;
  createdAt: string;
  cancelledAt?: string | null;
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

export interface OtherIncome {
  id: string;
  calendarEventId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  methodComment?: string | null;
  createdAt: string;
}

export interface RentalPayment {
  id: string;
  rentalId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  methodComment?: string | null;
  createdAt: string;
  renterDisplay?: string;
  locationId?: string | null;
  rentalDate?: string;
}

export type RenterCounterpartyType = "individual" | "sole_proprietor" | "company";

export type RenterStatus = "active" | "archived" | "blocked";

export type RenterContractStatus = "draft" | "active" | "expired" | "terminated";

export type RenterCommunicationType = "call" | "email" | "messenger" | "meeting" | "note";

export interface Renter {
  id: string;
  displayName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface RenterListItem {
  id: string;
  displayName: string;
  counterpartyType: RenterCounterpartyType;
  status: RenterStatus;
  contactPhone: string | null;
  contactEmail: string | null;
  primaryContactName: string | null;
  nextRentalDate: string | null;
  debtAmount: number | null;
  hasExpiringDocument: boolean;
  hasOverdueDebt: boolean;
  hasNextActionDue: boolean;
}

export interface RenterDetailCore {
  id: string;
  displayName: string;
  counterpartyType: RenterCounterpartyType | null;
  status: RenterStatus;
  contactPhone: string | null;
  contactEmail: string | null;
  legalName: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  legalAddress: string | null;
  actualAddress: string | null;
  blockedReason: string | null;
  internalNotes: string | null;
  preferredLocationIds: string[] | null;
  paymentDueDays: number | null;
  notes: string | null;
  archivedAt: string | null;
  nextRentalDate: string | null;
}

export interface RenterContact {
  id: string;
  fullName: string;
  roleTitle: string | null;
  phone: string | null;
  email: string | null;
  telegram: string | null;
  isPrimary: boolean;
  notes: string | null;
}

export interface RenterContract {
  id: string;
  contractNumber: string | null;
  title: string;
  contractType: string | null;
  signedAt: string | null;
  validFrom: string | null;
  validTo: string | null;
  status: RenterContractStatus;
  signatoryName: string | null;
  locationIds: string[];
  depositInfo: string | null;
}

export interface RenterDocument {
  id: string;
  contractId: string | null;
  category: string | null;
  displayName: string;
  documentDate: string | null;
  validUntil: string | null;
  mimeType: string;
  fileSize: number;
  createdAt: string;
}

export interface RenterCommunication {
  id: string;
  commType: RenterCommunicationType;
  occurredAt: string;
  subject: string | null;
  body: string | null;
  contactId: string | null;
  nextActionAt: string | null;
  authorMemberId: string;
  createdAt: string;
}

export interface RenterFinanceSummary {
  fixedTotal: number;
  paidTotal: number;
  debtTotal: number;
  overpaidTotal: number;
}

export interface RenterRentalCounts {
  completed: number;
  upcoming: number;
  cancelled: number;
}

export interface RenterDetail {
  renter: RenterDetailCore;
  contacts: RenterContact[];
  contracts: RenterContract[];
  documents: RenterDocument[];
  communications: RenterCommunication[];
  finance: RenterFinanceSummary | null;
  rentalCounts: RenterRentalCounts;
}

export interface RenterDuplicateMatch {
  id: string;
  displayName: string;
  counterpartyType: RenterCounterpartyType;
  status: RenterStatus;
  contactPhone: string | null;
  contactEmail: string | null;
  taxId: string | null;
  matchFields: string[];
}

export interface RenterRentalRow {
  id: string;
  rentalDate: string;
  timeStart: string;
  timeEnd: string;
  locationId: string;
  purpose: string | null;
  bookingStatus: "confirmed" | "cancelled";
  fixedAmount: number | null;
  currency: string | null;
  paidAmount: number | null;
  paymentStatus: string | null;
  cancelledAt: string | null;
}

export interface RenterUpsertInput {
  renterId?: string;
  displayName: string;
  counterpartyType?: RenterCounterpartyType;
  status?: RenterStatus;
  legalName?: string;
  taxId?: string;
  registrationNumber?: string;
  legalAddress?: string;
  actualAddress?: string;
  contactPhone?: string;
  contactEmail?: string;
  notes?: string;
  blockedReason?: string;
  internalNotes?: string;
  preferredLocationIds?: string[];
  paymentDueDays?: number | null;
  duplicateCreateReason?: string;
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
