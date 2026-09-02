import { describe, expect, it } from "vitest";
import { absolutizeSignedUrl, qrDownloadFilename } from "./qrUrl";

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
