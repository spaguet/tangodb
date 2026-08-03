import type { RentalDisplayLesson } from "../types";
import type { RentalPaymentInboxItem } from "../hooks/useRentalPaymentInbox";

/** Map inbox row to schedule rental lesson shape for payment modal / popup reuse. */
export function inboxItemToRentalLesson(item: RentalPaymentInboxItem): RentalDisplayLesson {
  return {
    kind: "rental",
    rentalId: item.rentalId,
    date: item.rentalDate,
    timeStart: item.timeStart,
    timeEnd: item.timeEnd,
    locationId: item.locationId,
    rentalSeriesId: item.rentalSeriesId,
    bookingStatus: "confirmed",
    purpose: item.purpose,
    renterName: item.renterName,
    paymentStatus: item.paymentStatus,
    fixedAmount: item.effectiveAmount,
    paidAmount: item.paidAmount,
    currency: item.currency,
  };
}
