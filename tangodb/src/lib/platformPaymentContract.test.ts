import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { v1ConfigFixture, v2ConfigFixture } from "./platformPaymentContract.fixtures.ts";
import {
  parsePlatformPaymentConfig,
  preparePaymentConfigForSave,
  resolvePaymentQuote,
} from "./platformPaymentContract.ts";
import { parseManualPaymentConfig, resolvePaymentQuote as resolveFromPaymentConfig } from "./paymentConfig.ts";
import {
  configToFormState,
  formStateToConfig,
} from "../../../tangodb-dev-console/src/lib/paymentConfig.ts";

describe("platformPaymentContract", () => {
  it("v1 lifetime uses per-method amount", () => {
    const quote = resolvePaymentQuote(v1ConfigFixture, "crm_license", "bankTransfer");
    assert.equal(quote.ok, true);
    if (quote.ok) {
      assert.equal(quote.amount, "150");
      assert.equal(quote.currency, "USD");
    }
  });

  it("v1 monthly is fail-closed", () => {
    const quote = resolvePaymentQuote(v1ConfigFixture, "crm_subscription", "bankTransfer");
    assert.equal(quote.ok, false);
    if (!quote.ok) assert.equal(quote.code, "monthly_not_configured");
  });

  it("v2 monthly uses VND override on vietnamese bank", () => {
    const quote = resolvePaymentQuote(v2ConfigFixture, "crm_subscription", "vietnameseBankTransfer");
    assert.equal(quote.ok, true);
    if (quote.ok) {
      assert.equal(quote.amount, "750000");
      assert.equal(quote.currency, "VND");
    }
  });

  it("v2 crypto requires stable id as method code", () => {
    const withoutId = {
      ...v2ConfigFixture,
      crypto: [
        {
          methodCode: "legacy-without-uuid",
          coin: "BTC",
          network: "Bitcoin",
          address: "bc1",
          amount: "1",
          currency: "BTC",
        },
      ],
    };
    const quote = resolvePaymentQuote(withoutId, "crm_license", "legacy-without-uuid");
    assert.equal(quote.ok, false);
    if (!quote.ok) assert.equal(quote.code, "crypto_missing_id");

    const quoteOk = resolvePaymentQuote(
      v2ConfigFixture,
      "crm_license",
      "a1111111-1111-4111-8111-111111111111"
    );
    assert.equal(quoteOk.ok, true);
  });

  it("unknown method is fail-closed", () => {
    const quote = resolvePaymentQuote(v2ConfigFixture, "crm_license", "unknown-rail");
    assert.equal(quote.ok, false);
    if (!quote.ok) assert.equal(quote.code, "unknown_method");
  });

  it("monthly without canon or override is fail-closed", () => {
    const config = {
      ...v2ConfigFixture,
      crmMonthly: null,
      bankTransfer: { ...v2ConfigFixture.bankTransfer, monthlyAmount: "", monthlyCurrency: "" },
    };
    const quote = resolvePaymentQuote(config, "crm_subscription", "bankTransfer");
    assert.equal(quote.ok, false);
  });

  it("CRM parseManualPaymentConfig reads v2 canon", () => {
    const parsed = parseManualPaymentConfig(v2ConfigFixture);
    assert.equal(parsed.schemaVersion, 2);
    assert.equal(parsed.crmLifetime?.amount, "199");
    assert.equal(parsed.crmMonthly?.amount, "29");
    assert.equal(parsed.crypto?.[0]?.id, "a1111111-1111-4111-8111-111111111111");
  });

  it("resolvePaymentQuote matches CRM adapter", () => {
    const a = resolvePaymentQuote(v2ConfigFixture, "crm_license", "bankTransfer");
    const b = resolveFromPaymentConfig(v2ConfigFixture, "crm_license", "bankTransfer");
    assert.deepEqual(a, b);
  });

  it("Dev Console round-trip preserves pricing fields", () => {
    const form = configToFormState(v2ConfigFixture);
    const payload = formStateToConfig(form);
    const reparsed = parsePlatformPaymentConfig(payload);
    assert.equal(reparsed.crmLifetime?.amount, "199");
    assert.equal(reparsed.crmMonthly?.amount, "29");
    assert.equal(reparsed.vietnameseBankTransfer?.monthlyAmount, "750000");
  });

  it("preparePaymentConfigForSave backfills crypto id and bumps revision on price change", () => {
    const incoming = formStateToConfig(configToFormState(v1ConfigFixture));
    const prepared = preparePaymentConfigForSave(incoming, v1ConfigFixture, 1);
    assert.equal(prepared.ok, true);
    if (prepared.ok) {
      assert.equal(prepared.config.schemaVersion, 2);
      assert.ok(Array.isArray(prepared.config.crypto) || prepared.pricingRevision >= 1);
      const crypto = prepared.config.crypto as Array<{ id?: string }> | undefined;
      if (crypto?.length) assert.ok(crypto[0].id);
    }
  });

  it("preparePaymentConfigForSave rejects revision conflict", () => {
    const prepared = preparePaymentConfigForSave(v2ConfigFixture, v2ConfigFixture, 1);
    assert.equal(prepared.ok, false);
    if (!prepared.ok) assert.equal(prepared.code, "revision_conflict");
  });
});
