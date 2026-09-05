import { describe, expect, it } from "vitest";
import { resolveTopupAmountMax, topupAmountMax } from "./topupLimits";

describe("topupLimits", () => {
  it("allows higher amounts for zero-decimal currencies", () => {
    expect(topupAmountMax("VND")).toBe(100_000_000);
    expect(topupAmountMax("KRW")).toBe(100_000_000);
    expect(topupAmountMax("RUB")).toBe(1_000_000);
  });

  it("prefers bootstrap max when provided", () => {
    expect(resolveTopupAmountMax("VND", 99_000_000)).toBe(99_000_000);
    expect(resolveTopupAmountMax("RUB", null)).toBe(1_000_000);
  });
});
