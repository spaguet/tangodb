import type { Locale } from "../i18n/strings";

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

export async function downloadQrToDevice(url: string, fileName: string): Promise<boolean> {
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    if (triggerAnchorDownload(url, fileName)) return true;
    window.open(url, "_blank", "noopener,noreferrer");
    return false;
  }

  const downloadFile = window.Telegram?.WebApp?.downloadFile;
  if (downloadFile) {
    const ok = await new Promise<boolean>((resolve) => {
      downloadFile({ url, file_name: fileName }, (status) => {
        if (status === "success" || status === "downloading") resolve(true);
        else resolve(false);
      });
    });
    if (ok) return true;
  }

  if (triggerAnchorDownload(url, fileName)) return true;
  window.open(url, "_blank", "noopener,noreferrer");
  return false;
}
