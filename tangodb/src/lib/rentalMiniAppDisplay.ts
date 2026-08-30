import { rentalRemainingAmount } from "./rentalAmount";
import type { RentalDisplayLesson } from "../types";

export function isMiniAppRentalChannel(
  lesson: Pick<RentalDisplayLesson, "channel"> | { channel?: string | null }
): boolean {
  return lesson.channel === "miniapp";
}

export function rentalLessonIsHold(
  lesson: Pick<RentalDisplayLesson, "channel" | "lifecycle">
): boolean {
  return isMiniAppRentalChannel(lesson) && lesson.lifecycle === "awaiting_payment";
}

/** Cashier: unpaid/partial remaining. Mini App: lifecycle=debt only. Never treat paid_amount NULL as 0. */
export function rentalLessonShowsDebtRing(
  lesson: Pick<
    RentalDisplayLesson,
    "channel" | "lifecycle" | "bookingStatus" | "paymentStatus" | "fixedAmount" | "paidAmount"
  >
): boolean {
  if (lesson.bookingStatus === "cancelled") return false;
  if (isMiniAppRentalChannel(lesson)) {
    return lesson.lifecycle === "debt";
  }
  if (lesson.paymentStatus !== "unpaid" && lesson.paymentStatus !== "partial") return false;
  return rentalRemainingAmount(lesson.fixedAmount, lesson.paidAmount) > 0;
}

export function miniAppLifecycleI18nKey(
  lifecycle: string | null | undefined
): "schedule.miniapp.lifecycle.awaiting"
  | "schedule.miniapp.lifecycle.active"
  | "schedule.miniapp.lifecycle.prepaid"
  | "schedule.miniapp.lifecycle.settled"
  | "schedule.miniapp.lifecycle.debt"
  | "schedule.miniapp.lifecycle.cancelled"
  | "schedule.miniapp.lifecycle.holdDeleted"
  | "schedule.miniapp.lifecycle.autoDeleted"
  | "schedule.miniapp.lifecycle.unknown" {
  switch (lifecycle) {
    case "awaiting_payment":
      return "schedule.miniapp.lifecycle.awaiting";
    case "active":
      return "schedule.miniapp.lifecycle.active";
    case "prepaid_charged":
      return "schedule.miniapp.lifecycle.prepaid";
    case "settled":
      return "schedule.miniapp.lifecycle.settled";
    case "debt":
      return "schedule.miniapp.lifecycle.debt";
    case "cancelled":
      return "schedule.miniapp.lifecycle.cancelled";
    case "hold_deleted":
      return "schedule.miniapp.lifecycle.holdDeleted";
    case "auto_deleted":
      return "schedule.miniapp.lifecycle.autoDeleted";
    default:
      return "schedule.miniapp.lifecycle.unknown";
  }
}
