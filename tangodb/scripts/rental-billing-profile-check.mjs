/**
 * Rental billing profile helpers (stage 17).
 * Run: npx tsx scripts/rental-billing-profile-check.mjs
 */
import {
  computeRentalVat,
  defaultFiscalStatusForMethod,
  parseRentalBillingProfile,
} from "../src/lib/rentalBillingProfile.ts";

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

const included = computeRentalVat(120, "included", 20);
assert(included.netAmount === 100 && included.vatAmount === 20, "included VAT");

const onTop = computeRentalVat(100, "on_top", 20);
assert(onTop.netAmount === 100 && onTop.vatAmount === 20, "on_top VAT");

assert(defaultFiscalStatusForMethod("card", true) === "pending", "card pending");
assert(defaultFiscalStatusForMethod("transfer", true) === "not_required", "transfer NR");

const profile = parseRentalBillingProfile({
  documents_mode: "crm",
  vat_mode: "included",
  vat_rate: 20,
  next_invoice_number: 5,
});
assert(profile.documents_mode === "crm", "parse mode");
assert(profile.next_invoice_number === 5, "parse next number");

console.log("rental-billing-profile-check: OK");
