/** Phase-1 offline scope — group attendance only; no auto payment sync. */
export const OFFLINE_ALLOWED = {
  groupAttendance: true,
  personalAttendance: false,
  singleVisit: false,
  subscriptionSale: false,
  scheduleEdit: false,
  clientEdit: false,
} as const;

export type OfflinePaymentDraftKind = "personal_lesson" | "single_visit" | "subscription";
