import type { Locale } from "../i18n/strings";
import { miniAppQrProxyUrl } from "./qrProxy";

export function topupDraftMessage(input: {
  locale: Locale;
  amountLabel: string;
  method: "qr" | "cash";
  correlationCode?: string;
}): string {
  const codePart =
    input.correlationCode != null && input.correlationCode !== ""
      ? input.locale === "en"
        ? ` Request code: ${input.correlationCode}.`
        : ` Код заявки: ${input.correlationCode}.`
      : "";

  if (input.locale === "en") {
    if (input.method === "qr") {
      return `Wallet top-up: ${input.amountLabel}. Method: studio QR transfer.${codePart} Receipt attached.`;
    }
    return `Wallet top-up: ${input.amountLabel}. I will pay cash at the studio.${codePart}`;
  }

  if (input.method === "qr") {
    return `Пополнение баланса: ${input.amountLabel}. Способ: перевод по QR студии.${codePart} Чек во вложении.`;
  }
  return `Пополнение баланса: ${input.amountLabel}. Оплачу наличными в студии.${codePart}`;
}

export function openStudioChat(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) return;
  const webApp = window.Telegram?.WebApp;
  if (trimmed.startsWith("https://t.me/") && webApp?.openTelegramLink) {
    webApp.openTelegramLink(trimmed);
    return;
  }
  if (webApp?.openLink) {
    webApp.openLink(trimmed);
    return;
  }
  window.open(trimmed, "_blank", "noopener,noreferrer");
}

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function triggerAnchorDownload(url: string, fileName: string): boolean {
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return true;
  } catch {
    return false;
  }
}

async function blobFromSrc(src: string): Promise<Blob | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (blob.size < 200) return null;
    const type = blob.type.toLowerCase();
    if (!type.startsWith("image/")) return null;
    return blob;
  } catch {
    return null;
  }
}

async function shareImageFile(blob: Blob, fileName: string): Promise<boolean> {
  const type = blob.type.startsWith("image/") ? blob.type : "image/png";
  const file = new File([blob], fileName, { type });
  if (typeof navigator.canShare !== "function" || !navigator.canShare({ files: [file] })) {
    return false;
  }
  try {
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return false;
    return false;
  }
}

async function verifyImageDownloadUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return false;
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    if (!contentType.startsWith("image/")) return false;
    const len = res.headers.get("content-length");
    if (len && Number(len) < 200) return false;
    return true;
  } catch {
    return false;
  }
}

type TelegramDownloadResult = "ok" | "cancelled" | "unavailable" | "failed";

async function telegramDownload(url: string, fileName: string): Promise<TelegramDownloadResult> {
  const downloadFile = window.Telegram?.WebApp?.downloadFile;
  if (typeof downloadFile !== "function") return "unavailable";
  try {
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result: TelegramDownloadResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const timeout = window.setTimeout(() => finish("failed"), 30_000);
      downloadFile({ url, file_name: fileName }, (status) => {
        window.clearTimeout(timeout);
        if (status === "success") finish("ok");
        else if (status === "cancelled") finish("cancelled");
        else if (status === "downloading") return;
        else finish("failed");
      });
    });
  } catch {
    return "failed";
  }
}

export async function downloadQrToDevice(
  displaySrc: string,
  fileName: string,
  downloadUrl?: string | null
): Promise<boolean> {
  const origin = window.location.origin;
  const httpsDownload =
    downloadUrl && /^https:\/\//i.test(downloadUrl)
      ? downloadUrl
      : /^https:\/\//i.test(displaySrc)
        ? displaySrc
        : null;
  const canProxy = Boolean(httpsDownload && /^https:\/\//i.test(origin));
  const proxyUrl = canProxy && httpsDownload ? miniAppQrProxyUrl(origin, httpsDownload, fileName) : null;

  if (proxyUrl && (await verifyImageDownloadUrl(proxyUrl))) {
    const telegramResult = await telegramDownload(proxyUrl, fileName);
    if (telegramResult === "ok") return true;
    if (telegramResult === "cancelled") return false;
  }

  const blobSrc = httpsDownload ?? displaySrc;
  const blob = await blobFromSrc(blobSrc);
  if (blob && (await shareImageFile(blob, fileName))) return true;

  if (!window.Telegram?.WebApp) {
    if (blob) {
      const objectUrl = URL.createObjectURL(blob);
      try {
        if (triggerAnchorDownload(objectUrl, fileName)) return true;
      } finally {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 2_000);
      }
    } else if (triggerAnchorDownload(displaySrc, fileName)) {
      return true;
    }
  }

  return false;
}
