import { describe, expect, it } from "vitest";
import { miniAppLifecycleKey } from "./lifecycle";

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
});
