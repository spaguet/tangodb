import { describe, expect, it } from "vitest";
import { quoteAvailable, quoteShortage, topupSuggestAmount } from "./quoteBalance";

describe("quoteBalance", () => {
  it("available is spendable when no debt", () => {
    expect(quoteAvailable({ spendable: 150, debt_amount: 0 })).toBe(150);
  });

  it("available is zero when debt outstanding", () => {
    expect(quoteAvailable({ spendable: 500, debt_amount: 50 })).toBe(0);
  });

  it("shortage is prepay minus available", () => {
    expect(quoteShortage(200, 80)).toBe(120);
    expect(quoteShortage(200, 250)).toBe(0);
  });

  it("topup without debt covers only shortage", () => {
    expect(topupSuggestAmount({ spendable: 80, debt_amount: 0 }, 200)).toBe(120);
    expect(topupSuggestAmount({ spendable: 300, debt_amount: 0 }, 200)).toBe(0);
  });

  it("topup with debt includes debt plus required prepay", () => {
    expect(topupSuggestAmount({ spendable: 0, debt_amount: 100 }, 200)).toBe(300);
  });
});
