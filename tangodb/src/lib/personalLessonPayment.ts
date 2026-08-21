/** Remaining billed amount not yet covered by net payments (never negative). */
export function personalLessonRemainingAmount(
  price: number | null | undefined,
  paidAmount: number | null | undefined
): number {
  return Math.max(0, (price ?? 0) - (paidAmount ?? 0));
}

/**
 * Whether the schedule cell should show the unpaid (rose) ring.
 * When billed/paid amounts are present (owner/director), remaining is the source of
 * truth so a stale `paid=no` after a closing payment does not keep the cell red.
 * When amounts are masked (teacher), fall back to the `paid` flag.
 */
export function personalLessonHasScheduleDebt(lesson: {
  paid: "yes" | "no";
  price?: number | null;
  paidAmount?: number | null;
  subscriptionId?: string | null;
}): boolean {
  if (lesson.subscriptionId) return false;
  const price = lesson.price;
  const paidAmount = lesson.paidAmount;
  if (typeof price === "number" && price > 0 && typeof paidAmount === "number") {
    return personalLessonRemainingAmount(price, paidAmount) > 0.005;
  }
  return lesson.paid === "no";
}
