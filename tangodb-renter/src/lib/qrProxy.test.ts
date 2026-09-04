import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isStudioQrSignedUrl,
  miniAppQrProxyUrl,
  proxyStudioQrRequest,
  sanitizeQrDownloadFilename,
} from "./qrProxy";

describe("isStudioQrSignedUrl", () => {
  it("accepts https supabase storage signed QR paths", () => {
    expect(
      isStudioQrSignedUrl(
        "https://gizfpiujqjwbjtqfstbj.supabase.co/storage/v1/object/sign/org-rental-qr/org/id.png?token=abc"
      )
    ).toBe(true);
  });

  it("rejects other hosts and schemes", () => {
    expect(isStudioQrSignedUrl("http://gizfpiujqjwbjtqfstbj.supabase.co/storage/v1/object/sign/org-rental-qr/x")).toBe(
      false
    );
    expect(isStudioQrSignedUrl("https://evil.example/storage/v1/object/sign/org-rental-qr/x")).toBe(false);
    expect(isStudioQrSignedUrl("https://gizfpiujqjwbjtqfstbj.supabase.co/storage/v1/object/sign/exports/x")).toBe(
      false
    );
  });

  it("accepts storage.supabase.co hosts", () => {
    expect(
      isStudioQrSignedUrl(
        "https://gizfpiujqjwbjtqfstbj.storage.supabase.co/storage/v1/object/sign/org-rental-qr/org/id.png?token=abc"
      )
    ).toBe(true);
  });
});

describe("miniAppQrProxyUrl", () => {
  it("builds a same-origin download URL", () => {
    const signed = "https://x.supabase.co/storage/v1/object/sign/org-rental-qr/a?token=1";
    const url = miniAppQrProxyUrl("https://tangodb-renter.vercel.app", signed, "VietQR-abcd.png");
    const parsed = new URL(url);
    expect(parsed.origin).toBe("https://tangodb-renter.vercel.app");
    expect(parsed.pathname).toBe("/api/qr-file");
    expect(parsed.searchParams.get("u")).toBe(signed);
    expect(parsed.searchParams.get("name")).toBe("VietQR-abcd.png");
  });
});

describe("sanitizeQrDownloadFilename", () => {
  it("strips path characters", () => {
    expect(sanitizeQrDownloadFilename("../a/b.png")).toBe("..-a-b.png");
  });
});

describe("proxyStudioQrRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns 404 without fetching non-allowlisted URLs", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await proxyStudioQrRequest(
      new Request("https://tangodb-renter.vercel.app/api/qr-file?u=https://evil.example/x")
    );
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
