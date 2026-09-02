import { describe, expect, it } from "vitest";
import { topupDraftMessage } from "./studioChat";

describe("topupDraftMessage", () => {
  it("includes amount and QR method in Russian", () => {
    const text = topupDraftMessage({
      locale: "ru",
      amountLabel: "500 000 ₫",
      method: "qr",
    });
    expect(text).toContain("500");
    expect(text).toContain("QR студии");
    expect(text.toLowerCase()).toContain("чек");
  });

  it("uses cash wording in English", () => {
    const text = topupDraftMessage({
      locale: "en",
      amountLabel: "$20.00",
      method: "cash",
    });
    expect(text).toContain("$20.00");
    expect(text.toLowerCase()).toContain("cash");
    expect(text.toLowerCase()).toContain("receipt");
  });
});
