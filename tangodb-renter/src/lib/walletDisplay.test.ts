import { describe, expect, it } from "vitest";
import {
  walletEntryAmountPrefix,
  walletEntryIsCredit,
  walletEntryLabelKey,
} from "./walletDisplay";

describe("walletDisplay", () => {
  it("labels entry types", () => {
    expect(walletEntryLabelKey("topup")).toBe("walletEntryTopup");
    expect(walletEntryLabelKey("debt_settle")).toBe("walletEntryDebtSettle");
    expect(walletEntryLabelKey("unknown")).toBeNull();
  });

  it("uses direction when present", () => {
    expect(walletEntryIsCredit({ entry_type: "debt_settle", direction: "credit" })).toBe(true);
    expect(walletEntryIsCredit({ entry_type: "topup", direction: "debit" })).toBe(false);
  });

  it("infers credit from entry_type when direction missing", () => {
    expect(walletEntryIsCredit({ entry_type: "topup", direction: null })).toBe(true);
    expect(walletEntryIsCredit({ entry_type: "refund", direction: null })).toBe(true);
    expect(walletEntryIsCredit({ entry_type: "prepay_charge", direction: null })).toBe(false);
  });

  it("prefixes signed amounts", () => {
    expect(walletEntryAmountPrefix({ entry_type: "topup", direction: "credit" })).toBe("+");
    expect(walletEntryAmountPrefix({ entry_type: "debt_settle", direction: "debit" })).toBe("−");
  });
});
