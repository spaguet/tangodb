import { describe, expect, it } from "vitest";
import {
  quoteAvailable,
  quoteShortage,
  rentalQuoteCoverage,
  suggestedTopupAmount,
  topupSuggestAmount,
} from "./quoteBalance";

describe("quoteBalance", () => {
  it("available is spendable when no debt", () => {
    expect(quoteAvailable({ spendable: 150, debt_amount: 0 })).toBe(150);
  });

  it("available is zero when debt outstanding", () => {
    expect(quoteAvailable({ spendable: 500, debt_amount: 50 })).toBe(0);
  });

  it("shortage is coverage minus available", () => {
    expect(quoteShortage(200, 80)).toBe(120);
    expect(quoteShortage(200, 250)).toBe(0);
  });

  it("coverage prefers fixed amount, then quote cost, then prepay+remainder", () => {
    expect(rentalQuoteCoverage({ fixedAmount: 1000, cost: 900, prepay: 400, remainder: 400 })).toBe(
      1000
    );
    expect(rentalQuoteCoverage({ cost: 900, prepay: 400, remainder: 400 })).toBe(900);
    expect(rentalQuoteCoverage({ prepay: 400, remainder: 400 })).toBe(800);
  });

  it("topup without debt covers 100% shortage", () => {
    expect(topupSuggestAmount({ spendable: 80, debt_amount: 0 }, 1000)).toBe(920);
    expect(topupSuggestAmount({ spendable: 300, debt_amount: 0 }, 200)).toBe(0);
  });

  it("topup with debt includes debt plus 100% rental", () => {
    expect(topupSuggestAmount({ spendable: 0, debt_amount: 100 }, 1000)).toBe(1100);
  });

  it("suggested topup falls back to full coverage without wallet", () => {
    expect(suggestedTopupAmount(1000, null)).toBe(1000);
    expect(suggestedTopupAmount(1000, { spendable: 200, debt_amount: 0 })).toBe(800);
  });
});
