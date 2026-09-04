import { describe, expect, it } from "vitest";
import { absolutizeSignedUrl, qrDisplaySrc, qrDownloadFilename } from "./qrUrl";

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
});

describe("qrDisplaySrc", () => {
  it("prefers inline base64 over signed URL so Telegram WebView can render the image", () => {
    expect(
      qrDisplaySrc({
        signed_url: "https://example.supabase.co/storage/v1/object/sign/x",
        content_base64: "abc123",
        mime_type: "image/jpeg",
      })
    ).toBe("data:image/jpeg;base64,abc123");
  });

  it("falls back to absolute signed URL", () => {
    expect(
      qrDisplaySrc({
        signed_url: "https://example.supabase.co/storage/v1/object/sign/x",
        content_base64: null,
      })
    ).toBe("https://example.supabase.co/storage/v1/object/sign/x");
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
