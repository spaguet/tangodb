/** Server quote resolver for create-purchase-quote / submit (S2b+). */
export {
  parsePlatformPaymentConfig,
  resolvePaymentQuote,
  type PaymentQuoteResult,
  type PaymentQuoteSuccess,
  type PaymentQuoteFailure,
  type PlatformPaymentSku,
} from "./platformPaymentContract.ts";
