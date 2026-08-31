/** Min payment-comment length for submit-purchase-request (keep in sync with Edge _shared). */
export const PURCHASE_REQUEST_COMMENT_MIN_LENGTH = 10;

export function isPurchaseCommentValid(comment: string): boolean {
  return comment.trim().length >= PURCHASE_REQUEST_COMMENT_MIN_LENGTH;
}
