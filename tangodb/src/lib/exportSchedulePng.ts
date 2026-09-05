import { toBlob } from "html-to-image";
import { isMobileExportContext } from "./exportCsv";

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();

  window.setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 250);
}

async function trySharePngFile(file: File): Promise<"shared" | "failed" | "cancelled"> {
  if (typeof navigator.share !== "function") return "failed";
  try {
    if (navigator.canShare && !navigator.canShare({ files: [file] })) return "failed";
    await navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    return "failed";
  }
}

export type SchedulePngExportResult = "downloaded" | "shared" | "cancelled" | "failed";

/** Capture a schedule DOM subtree and save as PNG (download or mobile share). */
export async function exportSchedulePng(
  element: HTMLElement,
  filename: string
): Promise<SchedulePngExportResult> {
  const blob = await toBlob(element, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: "#ffffff",
  });

  if (!blob) return "failed";

  const file = new File([blob], filename, { type: "image/png" });

  if (isMobileExportContext()) {
    const shared = await trySharePngFile(file);
    if (shared === "shared") return "shared";
    if (shared === "cancelled") return "cancelled";
  }

  downloadBlob(blob, filename);
  return "downloaded";
}

export function buildSchedulePngFilename(weekStartISO: string, weekEndISO: string): string {
  return `schedule_${weekStartISO}_${weekEndISO}.png`;
}

export function waitForDomPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.setTimeout(resolve, 80);
      });
    });
  });
}
