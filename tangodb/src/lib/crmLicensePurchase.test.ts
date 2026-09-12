import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowManualPurchasePanel,
  parsePurchasePlanParam,
  prefillSkuFromPlan,
  purchaseCtaKind,
  purchaseCtaPath,
  purchaseSkuLock,
  resolveSelectedSku,
} from "./crmLicensePurchase.ts";

describe("crmLicensePurchase", () => {
  it("?plan= only prefills SKU and does not invent a quote sku", () => {
    assert.equal(parsePurchasePlanParam("monthly"), "monthly");
    assert.equal(parsePurchasePlanParam("lifetime"), "lifetime");
    assert.equal(parsePurchasePlanParam("crm_subscription"), null);
    assert.equal(prefillSkuFromPlan("monthly"), "crm_subscription");
    assert.equal(prefillSkuFromPlan("lifetime"), "crm_license");
    assert.equal(prefillSkuFromPlan(null), "");
  });

  it("lifetime org never sees the purchase panel or CTA", () => {
    assert.equal(
      canShowManualPurchasePanel({
        isPurchaseFlow: true,
        orgStatus: "licensed",
        licenseType: "lifetime",
        subscriptionStatus: "canceled",
      }),
      false
    );
    assert.equal(
      purchaseCtaKind({
        orgStatus: "licensed",
        licenseType: "lifetime",
        subscriptionStatus: "active",
      }),
      null
    );
  });

  it("demo / monthly / suspended can open the panel; purge hides demo", () => {
    assert.equal(
      canShowManualPurchasePanel({
        isPurchaseFlow: true,
        orgStatus: "demo_active",
        licenseType: null,
        dataPurgeAt: "2099-01-01T00:00:00.000Z",
      }),
      true
    );
    assert.equal(
      canShowManualPurchasePanel({
        isPurchaseFlow: true,
        orgStatus: "demo_retention",
        licenseType: null,
        dataPurgeAt: "2000-01-01T00:00:00.000Z",
        now: new Date("2026-09-12T00:00:00.000Z"),
      }),
      false
    );
    assert.equal(
      canShowManualPurchasePanel({
        isPurchaseFlow: true,
        orgStatus: "licensed",
        licenseType: "subscription",
        subscriptionStatus: "active",
      }),
      true
    );
    assert.equal(
      canShowManualPurchasePanel({
        isPurchaseFlow: true,
        orgStatus: "licensed",
        licenseType: "subscription",
        subscriptionStatus: "past_due",
      }),
      true
    );
    assert.equal(
      canShowManualPurchasePanel({
        isPurchaseFlow: true,
        orgStatus: "suspended",
        licenseType: "subscription",
        subscriptionStatus: "canceled",
      }),
      true
    );
    assert.equal(
      canShowManualPurchasePanel({
        isPurchaseFlow: false,
        orgStatus: "demo_active",
        licenseType: null,
      }),
      false
    );
  });

  it("monthly lock ignores ?plan=lifetime; suspended keeps SKU choice", () => {
    assert.equal(
      purchaseSkuLock({
        orgStatus: "licensed",
        licenseType: "subscription",
        subscriptionStatus: "active",
      }),
      "monthly"
    );
    assert.equal(
      resolveSelectedSku("monthly", "lifetime", "crm_license"),
      "crm_subscription"
    );
    assert.equal(
      purchaseSkuLock({
        orgStatus: "suspended",
        licenseType: "subscription",
        subscriptionStatus: "canceled",
      }),
      "choice"
    );
    assert.equal(resolveSelectedSku("choice", "monthly", ""), "crm_subscription");
    assert.equal(resolveSelectedSku("choice", "monthly", "crm_license"), "crm_license");
  });

  it("CTA is demo buy, past_due/suspended renew, not monthly-active nav", () => {
    assert.equal(
      purchaseCtaKind({ orgStatus: "demo_active", licenseType: null }),
      "buy"
    );
    assert.equal(
      purchaseCtaKind({
        orgStatus: "licensed",
        licenseType: "subscription",
        subscriptionStatus: "past_due",
      }),
      "renew"
    );
    assert.equal(
      purchaseCtaKind({
        orgStatus: "licensed",
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      }),
      null
    );
    assert.equal(
      purchaseCtaKind({
        orgStatus: "suspended",
        licenseType: "subscription",
        subscriptionStatus: "canceled",
      }),
      "renew"
    );
    assert.equal(purchaseCtaPath("renew").includes("plan=monthly"), true);
  });

  it("CTA renews on T−7 and on an expired period while status is still active", () => {
    const now = new Date("2026-09-12T12:00:00.000Z");
    assert.equal(
      purchaseCtaKind({
        orgStatus: "licensed",
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2026-09-15T12:00:00.000Z",
        now,
      }),
      "renew"
    );
    assert.equal(
      purchaseCtaKind({
        orgStatus: "licensed",
        licenseType: "subscription",
        subscriptionStatus: "active",
        currentPeriodEnd: "2026-09-12T12:00:00.000Z",
        now,
      }),
      "renew"
    );
  });
});
