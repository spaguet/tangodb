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
  clientId1?: string;
  clientId2?: string;
  clientId3?: string;
  clientId4?: string;
  clientDisplay?: string;
  priceId?: string | null;
  payerClientId?: string | null;
  subscriptionId?: string | null;
  price?: number;
  paidAmount?: number;
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
  rentalSeriesId?: string | null;
  bookingStatus: "confirmed" | "cancelled";
  purpose?: string | null;
  renterName?: string | null;
  paymentStatus?: RentalPaymentStatus | null;
  fixedAmount?: number | null;
  paidAmount?: number | null;
  currency?: string;
  channel?: RentalChannel;
  lifecycle?: string | null;
  canDeleteHold?: boolean;
  canCancelOccurrence?: boolean;
  canCancelPack?: boolean;
}

export type RentalTariffType = "hourly" | "fixed";

export type RentalTariffStatus = "active" | "archived";

export interface RentalTariffRule {
  id?: string;
  priority: number;
  daysOfWeek: number[];
  timeStart: string;
  timeEnd: string;
  priceOverride: number;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface RentalTariff {
  id: string;
  name: string;
  tariffType: RentalTariffType;
  locationId: string | null;
  price: number | null;
  currency: string | null;
  minDurationMinutes: number;
  roundingStepMinutes: number;
  validFrom: string | null;
  validTo: string | null;
  status: RentalTariffStatus;
  rulesCount: number;
}

export type RentalSeriesStatus = "active" | "cancelled" | "completed";

export interface RentalSeriesPattern {
  id?: string;
  daysOfWeek: number[];
  timeStart: string;
  timeEnd: string;
}

export interface RentalSeries {
  id: string;
  renterId: string;
  contractId: string | null;
  locationId: string;
  tariffId: string;
  validFrom: string;
  validTo: string;
  status: RentalSeriesStatus;
  purpose: string | null;
}

export interface RentalSeriesPreviewOccurrence {
  occurrenceDate: string;
  timeStart: string;
  timeEnd: string;
  patternId?: string | null;
  locationId: string;
  calculatedAmount: number | null;
  currency: string | null;
  tariffType: RentalTariffType | null;
  pricingBreakdown: unknown | null;
  conflicts: unknown[];
  hasConflict: boolean;
}

export type RentalInvoiceStatus =
  | "draft"
  | "invoiced"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "cancelled";

export type RentalFiscalStatus =
  | "not_required"
  | "pending"
  | "issued"
  | "failed"
  | "refunded";

export interface RentalInvoice {
  id: string;
  seriesId: string | null;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: RentalInvoiceStatus;
  currency: string;
  totalAmount: number;
  paidAmount: number;
  outstanding: number;
  documentNumber?: string | null;
  documentVersion?: number;
  vatMode?: "none" | "included" | "on_top" | null;
  vatRate?: number | null;
  netAmount?: number | null;
  vatAmount?: number | null;
  issuedAt?: string | null;
  exportBatchId?: string | null;
}

export interface RentalAdvance {
  id: string;
  amount: number;
  allocatedAmount: number;
  available: number;
  currency: string;
  method: PaymentMethod;
  operationDate: string;
  receivedAt: string;
}

export interface RentalAdvanceAllocation {
  id: string;
  advanceId: string;
  invoiceId: string;
  invoicePeriodStart: string;
  invoicePeriodEnd: string;
  amount: number;
  allocatedAt: string;
  cancelledAt: string | null;
  allocatedBy: string | null;
}

export interface RentalAccrualReport {
  periodStart: string;
  periodEnd: string;
  renterId: string | null;
  accruedAmount: number;
  paidDirect: number;
  paidInvoice: number;
  paidTotal: number;
  advancesReceived: number;
  advancesAllocated: number;
  invoiceDebt: number;
  uninvoicedDebt: number;
  totalDebt: number;
}

export interface RentalDeposit {
  id: string;
  balance: number;
  currency: string;
  contractId: string | null;
  updatedAt: string;
}

export interface RenterRentalFinanceExtended {
  invoiceDebt: number;
  uninvoicedRentalDebt: number;
  totalDebt: number;
  advanceBalance: number;
  depositBalance: number;
  overdueAmount: number;
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
  disciplineIds?: string[];
  teacherMemberIds?: string[];
  billingModel?: BillingModel;
  freezeMaxCount?: number | null;
  freezeMinLessons?: number | null;
  status?: "active" | "archived";
  createdAt?: string;
  archivedAt?: string | null;
  salesCount?: number;
  durationMinutes?: number | null;
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
  paidAmount: number;
  disciplineId?: string | null;
  subscriptionId?: string | null;
  locationId?: string | null;
  teacherMemberId?: string | null;
  attendanceStatus?: "present" | "absent" | "excused" | null;
  priceId?: string | null;
  payerClientId?: string | null;
  billingSplitMode?: "single_payer" | "equal";
}

export type PersonalLessonBillingSplitMode = "single_payer" | "equal";

export interface PersonalLessonCharge {
  id: string;
  personalLessonId: string;
  clientId: string;
  billedAmount: number;
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
  personalLessonChargeId?: string | null;
  singleVisitId: string | null;
  createdBy: string | null;
  createdAt: string;
  priceId?: string | null;
  tariffDurationMinutes?: number | null;
  tariffUnits?: number | null;
  tariffPrice?: number | null;
  tariffLabel?: string | null;
  lessonDurationMinutes?: number | null;
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
  operationDate?: string;
  createdBy?: string | null;
  operationKind?: "payment" | "storno";
  reversesPaymentId?: string | null;
  replacesPaymentId?: string | null;
  correctionReasonCode?: string | null;
  correctionComment?: string | null;
  operationNumber?: number | null;
  correctionStatus?: import("../lib/paymentCorrection").PaymentCorrectionStatus;
  remainingAmount?: number;
  renterDisplay?: string;
  locationId?: string | null;
  rentalDate?: string;
  fiscalStatus?: RentalFiscalStatus;
  fiscalReceiptNumber?: string | null;
  fiscalCashRegisterId?: string | null;
  fiscalTerminalId?: string | null;
  fiscalAcquiringId?: string | null;
  fiscalRefundReceiptNumber?: string | null;
}

/** Canonical rental cash register entry (stage 5). */
export type RentalMoneyEntryType =
  | "direct_booking_payment"
  | "direct_booking_storno"
  | "invoice_payment"
  | "advance_received"
  | "deposit_receive"
  | "deposit_return";

export interface RentalMoneyRegisterEntry {
  registerKey: string;
  id: string;
  entryType: RentalMoneyEntryType;
  sourceTable: string;
  sourceId: string;
  signedAmount: number;
  amount: number;
  currency: string;
  method: PaymentMethod;
  methodComment?: string | null;
  renterId?: string | null;
  renterDisplay?: string;
  rentalId?: string | null;
  invoiceId?: string | null;
  advanceId?: string | null;
  depositId?: string | null;
  createdBy?: string | null;
  createdAt: string;
  operationDate: string;
  rentalDate?: string;
  locationId?: string | null;
  operationKind?: "payment" | "storno";
  reversesPaymentId?: string | null;
  replacesPaymentId?: string | null;
  correctionReasonCode?: string | null;
  correctionComment?: string | null;
  operationNumber?: number | null;
  correctionStatus?: import("../lib/paymentCorrection").PaymentCorrectionStatus;
  remainingAmount?: number;
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
  telegramId?: string | null;
}

export type RenterDebtFilter = "cashier" | "miniapp" | "any";

export interface RenterListItem {
  id: string;
  displayName: string;
  counterpartyType: RenterCounterpartyType;
  status: RenterStatus;
  contactPhone: string | null;
  contactEmail: string | null;
  primaryContactName: string | null;
  nextRentalDate: string | null;
  cashierDebt: number | null;
  miniappDebt: number | null;
  hasExpiringDocument: boolean;
  hasOverdueDebt: boolean;
  hasNextActionDue: boolean;
  telegramId: string | null;
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
  telegramId: string | null;
  onTimeCount: number | null;
  untimelyCount: number | null;
  bookingBannedAt: string | null;
  penaltyTariffAppliedAt: string | null;
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

export interface RenterWalletLedgerEntry {
  id: string;
  entryType: string;
  amount: number;
  createdAt: string;
  externalReference?: string | null;
  correctionReason?: string | null;
  correctsLedgerId?: string | null;
  payoutMethod?: string | null;
  canReverse?: boolean;
}

export interface RenterMiniAppDebtRow {
  rentalId: string;
  rentalDate: string;
  timeStart: string;
  timeEnd: string;
  debtAmount: number;
  locationId: string | null;
}

export interface RenterFinanceSummary {
  fixedTotal: number;
  paidTotal: number;
  debtTotal: number;
  overpaidTotal: number;
  walletBalance: number;
  spendable: number;
  reservedPrepay: number;
  miniappDebtTotal: number;
  walletEntries: RenterWalletLedgerEntry[];
  miniappDebts: RenterMiniAppDebtRow[];
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

export type RentalChannel = "cashier" | "miniapp";

export interface RenterRentalRow {
  id: string;
  rentalDate: string;
  timeStart: string;
  timeEnd: string;
  locationId: string;
  purpose: string | null;
  bookingStatus: "confirmed" | "cancelled";
  channel: RentalChannel;
  lifecycle: string | null;
  fixedAmount: number | null;
  currency: string | null;
  paidAmount: number | null;
  paymentStatus: string | null;
  cancelledAt: string | null;
  debtAmount: number | null;
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
  telegramId?: string | null;
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
