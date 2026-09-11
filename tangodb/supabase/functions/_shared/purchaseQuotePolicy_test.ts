import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { v2ConfigFixture } from "../../../src/lib/platformPaymentContract.fixtures.ts";
import { resolvePaymentQuote } from "./paymentQuote.ts";
import {
  assertQuoteCreationAllowed,
  computeQuoteExpiresAt,
  isUuid,
  parsePurchaseQuoteSku,
  PURGE_QUOTE_MIN_WINDOW_MS,
  QUOTE_TTL_MS,
} from "./purchaseQuotePolicy.ts";

Deno.test("computeQuoteExpiresAt caps at purge and 24h", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  const purge = "2026-01-02T00:00:00.000Z";
  assertEquals(
    computeQuoteExpiresAt(now, purge),
    new Date(now + 12 * 60 * 60 * 1000).toISOString()
  );
  assertEquals(
    computeQuoteExpiresAt(now, null),
    new Date(now + QUOTE_TTL_MS).toISOString()
  );
});

Deno.test("assertQuoteCreationAllowed rejects past purge and short window", () => {
  const purge = Date.parse("2026-01-01T12:00:00.000Z");
  assertEquals(assertQuoteCreationAllowed(purge + 1, new Date(purge).toISOString()).ok, false);
  assertEquals(
    assertQuoteCreationAllowed(
      purge - PURGE_QUOTE_MIN_WINDOW_MS + 1,
      new Date(purge).toISOString()
    ).ok,
    false
  );
  assertEquals(
    assertQuoteCreationAllowed(purge - PURGE_QUOTE_MIN_WINDOW_MS - 1000, new Date(purge).toISOString())
      .ok,
    true
  );
});

Deno.test("parsePurchaseQuoteSku and isUuid", () => {
  assertEquals(parsePurchaseQuoteSku("crm_license"), "crm_license");
  assertEquals(parsePurchaseQuoteSku("crm_subscription"), "crm_subscription");
  assertEquals(parsePurchaseQuoteSku("renter_miniapp_addon"), null);
  assertEquals(isUuid("not-a-uuid"), false);
  assertEquals(isUuid("a0900000-0000-4000-8000-000000000001"), true);
});

Deno.test("resolvePaymentQuote rejects spoofed monthly without config", () => {
  const monthly = resolvePaymentQuote(v2ConfigFixture, "crm_subscription", "bankTransfer");
  assertEquals(monthly.ok, true);
  if (!monthly.ok) throw new Error("unreachable");
  assertEquals(monthly.amount, "29");
});

Deno.test("resolvePaymentQuote rejects unknown method", () => {
  const result = resolvePaymentQuote(v2ConfigFixture, "crm_license", "does-not-exist");
  assertEquals(result.ok, false);
  if (result.ok) throw new Error("unreachable");
  assertEquals(result.code, "unknown_method");
});
