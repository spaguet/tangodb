import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isMonthlyRequestKind,
  kindToRequestKind,
  kindLabel,
  rowKind,
} from "./purchaseInboxKind.ts";

describe("purchaseInboxKind", () => {
  it("Studio fixture: rowKind is not lifetime license", () => {
    assert.equal(rowKind("crm_studio_subscription"), "crm_studio_subscription");
    assert.notEqual(rowKind("crm_studio_subscription"), "crm_license");
  });

  it("isMonthly includes Pro and Studio month kinds", () => {
    assert.equal(isMonthlyRequestKind(rowKind("crm_subscription")), true);
    assert.equal(isMonthlyRequestKind(rowKind("crm_studio_subscription")), true);
    assert.equal(isMonthlyRequestKind(rowKind("crm_license")), false);
  });

  it("monthly filter maps only to Pro month SKU", () => {
    assert.equal(kindToRequestKind("monthly"), "crm_subscription");
    assert.equal(kindToRequestKind("studio"), "crm_studio_subscription");
    assert.notEqual(kindToRequestKind("monthly"), "crm_studio_subscription");
  });

  it("kindLabel distinguishes Studio and Pro month", () => {
    assert.equal(kindLabel("crm_studio_subscription"), "Studio / месяц");
    assert.equal(kindLabel("crm_subscription"), "Pro / месяц");
    assert.equal(kindLabel("crm_license"), "Pro / пожизненно");
  });

  it("unknown kind is fail-closed", () => {
    assert.equal(rowKind("crm_foo"), "unknown");
    assert.equal(kindLabel("unknown"), "Unknown request kind");
  });
});
