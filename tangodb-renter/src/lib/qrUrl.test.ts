import { describe, expect, it } from "vitest";
import { absolutizeSignedUrl, qrDisplaySrc, qrDownloadFilename, qrHttpsDownloadUrl } from "./qrUrl";

describe("absolutizeSignedUrl", () => {
  it("keeps absolute https URLs", () => {
    expect(absolutizeSignedUrl("https://example.supabase.co/storage/v1/object/sign/x")).toBe(
      "https://example.supabase.co/storage/v1/object/sign/x"
    );
  });

  it("returns null for empty", () => {
    expect(absolutizeSignedUrl(null)).toBeNull();
    expect(absolutizeSignedUrl("  ")).toBeNull();
  });

  it("does not treat data URLs as Storage paths", () => {
    expect(absolutizeSignedUrl("data:image/png;base64,abc")).toBeNull();
  });
});

describe("qrDisplaySrc", () => {
  it("prefers the Storage signed URL over inline base64", () => {
    expect(
      qrDisplaySrc({
        signed_url: "https://example.supabase.co/storage/v1/object/sign/x",
        content_base64: "abc123",
        mime_type: "image/jpeg",
      })
    ).toBe("https://example.supabase.co/storage/v1/object/sign/x");
  });

  it("falls back to inline base64 when no signed URL", () => {
    expect(
      qrDisplaySrc({
        signed_url: null,
        content_base64: "abc123",
        mime_type: "image/png",
      })
    ).toBe("data:image/png;base64,abc123");
  });
});

describe("qrHttpsDownloadUrl", () => {
  it("returns only https Storage URLs", () => {
    expect(
      qrHttpsDownloadUrl({ signed_url: "https://example.supabase.co/storage/v1/object/sign/x" })
    ).toBe("https://example.supabase.co/storage/v1/object/sign/x");
    expect(qrHttpsDownloadUrl({ signed_url: "data:image/png;base64,abc" })).toBeNull();
  });
});

describe("qrDownloadFilename", () => {
  it("uses label and short id", () => {
    expect(qrDownloadFilename("VietQR", "8b65fa2f-aaaa-bbbb-cccc-ddddeeeeffff")).toBe(
      "VietQR-8b65fa2f.png"
    );
  });

  it("falls back when label is empty", () => {
    expect(qrDownloadFilename(null, "8b65fa2f-aaaa")).toBe("studio-qr-8b65fa2f.png");
  });
});
