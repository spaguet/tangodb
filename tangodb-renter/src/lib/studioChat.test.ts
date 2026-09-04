import { describe, expect, it } from "vitest";
import { topupDraftMessage } from "./studioChat";

describe("topupDraftMessage", () => {
  it("includes correlation code and QR wording in Russian", () => {
    const text = topupDraftMessage({
      locale: "ru",
      amountLabel: "500 000 ₫",
      method: "qr",
      correlationCode: "TDB-7K4P",
    });
    expect(text).toContain("500");
    expect(text).toContain("QR студии");
    expect(text).toContain("TDB-7K4P");
    expect(text.toLowerCase()).toContain("чек");
  });

  it("uses cash wording without receipt in Russian", () => {
    const text = topupDraftMessage({
      locale: "ru",
      amountLabel: "1 000 ₽",
      method: "cash",
      correlationCode: "TDB-AB12",
    });
    expect(text).toContain("наличными");
    expect(text).toContain("TDB-AB12");
    expect(text.toLowerCase()).not.toContain("чек");
  });

  it("uses cash wording in English without receipt", () => {
    const text = topupDraftMessage({
      locale: "en",
      amountLabel: "$20.00",
      method: "cash",
      correlationCode: "TDB-ZZ99",
    });
    expect(text).toContain("$20.00");
    expect(text.toLowerCase()).toContain("cash");
    expect(text).toContain("TDB-ZZ99");
    expect(text.toLowerCase()).not.toContain("receipt");
  });

  it("includes receipt for QR in English", () => {
    const text = topupDraftMessage({
      locale: "en",
      amountLabel: "$50.00",
      method: "qr",
      correlationCode: "TDB-1A2B",
    });
    expect(text.toLowerCase()).toContain("receipt");
    expect(text).toContain("TDB-1A2B");
  });
});
