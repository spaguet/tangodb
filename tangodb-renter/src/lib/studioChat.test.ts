import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadQrToDevice, topupDraftMessage } from "./studioChat";

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

describe("downloadQrToDevice", () => {
  const signed = "https://x.supabase.co/storage/v1/object/sign/org-rental-qr/a?token=1";

  afterEach(() => {
    delete window.Telegram;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses Telegram downloadFile with a same-origin proxy URL", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://tangodb-renter.vercel.app" },
    });
    const downloadFile = vi.fn(
      (_params: { url: string; file_name: string }, cb?: (status: "downloading") => void) => {
        cb?.("downloading");
      }
    );
    window.Telegram = { WebApp: { downloadFile } } as never;

    await expect(downloadQrToDevice("https://ignored.example/x.png", "qr.png", signed)).resolves.toBe(true);
    expect(downloadFile).toHaveBeenCalledTimes(1);
    const url = String(downloadFile.mock.calls[0]?.[0]?.url ?? "");
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://tangodb-renter.vercel.app");
    expect(parsed.pathname).toBe("/api/qr-file");
    expect(parsed.searchParams.get("u")).toBe(signed);
    expect(parsed.searchParams.get("name")).toBe("qr.png");
  });

  it("does not treat an in-Telegram cancel as a successful save", async () => {
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { origin: "https://tangodb-renter.vercel.app" },
    });
    const downloadFile = vi.fn(
      (_params: { url: string; file_name: string }, cb?: (status: "cancelled") => void) => {
        cb?.("cancelled");
      }
    );
    window.Telegram = { WebApp: { downloadFile } } as never;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(downloadQrToDevice(signed, "qr.png", signed)).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
