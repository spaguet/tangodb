import { describe, expect, it } from "vitest";
import { miniAppLifecycleKey, occupiesMiniAppGrid } from "./lifecycle";

describe("miniAppLifecycleKey", () => {
  it("maps known lifecycles to mini app labels", () => {
    expect(miniAppLifecycleKey("awaiting_payment")).toBe("lifecycleAwaiting");
    expect(miniAppLifecycleKey("active")).toBe("lifecycleActive");
    expect(miniAppLifecycleKey("prepaid_charged")).toBe("lifecyclePrepaid");
    expect(miniAppLifecycleKey("settled")).toBe("lifecycleSettled");
    expect(miniAppLifecycleKey("debt")).toBe("lifecycleDebt");
    expect(miniAppLifecycleKey("cancelled")).toBe("lifecycleCancelled");
  });

  it("falls back to unknown", () => {
    expect(miniAppLifecycleKey("prepaid_charged_raw")).toBe("lifecycleUnknown");
    expect(miniAppLifecycleKey(null)).toBe("lifecycleUnknown");
  });

  it("treats cancelled terminal lifecycles as gone from the grid", () => {
    expect(occupiesMiniAppGrid("active")).toBe(true);
    expect(occupiesMiniAppGrid("awaiting_payment")).toBe(true);
    expect(occupiesMiniAppGrid("prepaid_charged")).toBe(true);
    expect(occupiesMiniAppGrid("settled")).toBe(true);
    expect(occupiesMiniAppGrid("debt")).toBe(true);
    expect(occupiesMiniAppGrid("cancelled")).toBe(false);
    expect(occupiesMiniAppGrid("hold_deleted")).toBe(false);
    expect(occupiesMiniAppGrid("auto_deleted")).toBe(false);
    expect(occupiesMiniAppGrid(null)).toBe(false);
  });
});
