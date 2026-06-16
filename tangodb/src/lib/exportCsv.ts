import { isInsideTelegramClient } from "./telegram";

const CSV_SEPARATOR = ";";
const CSV_BOM = "\uFEFF";

function escapeCsvCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  const needsQuotes = /[;"\n\r]/.test(str);
  const escaped = str.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Build CSV text with UTF-8 BOM for Excel. */
export function buildCsvContent(
  rows: Record<string, string | number | null | undefined>[],
  columnLabels?: Record<string, string>
): string {
  const columns = columnLabels
    ? Object.keys(columnLabels)
    : rows.length > 0
      ? Object.keys(rows[0])
      : [];

  const headerLine = columns
    .map((key) => escapeCsvCell(columnLabels?.[key] ?? key))
    .join(CSV_SEPARATOR);

  const dataLines = rows.map((row) =>
    columns.map((key) => escapeCsvCell(row[key])).join(CSV_SEPARATOR)
  );

  return CSV_BOM + [headerLine, ...dataLines].join("\r\n");
}

export type CsvExportMethod = "share" | "download" | "open-tab";

export interface CsvExportItem {
  rows: Record<string, string | number | null | undefined>[];
  filename: string;
  columnLabels?: Record<string, string>;
}

export function isMobileExportContext(): boolean {
  if (typeof navigator === "undefined") return false;

  const tgPlatform = window.Telegram?.WebApp?.platform;
  if (tgPlatform === "ios" || tgPlatform === "android") return true;

  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;

  return navigator.maxTouchPoints > 1 && window.innerWidth < 1024;
}

function canShareFiles(files: File[]): boolean {
  if (typeof navigator.share !== "function" || typeof File === "undefined") return false;
  try {
    return !navigator.canShare || navigator.canShare({ files });
  } catch {
    return false;
  }
}

function csvFileFromItem(item: CsvExportItem): File {
  const content = buildCsvContent(item.rows, item.columnLabels);
  return new File([content], item.filename, { type: "text/csv;charset=utf-8" });
}

function mergeCsvExportItems(items: CsvExportItem[], mergedFilename: string): File {
  const parts = items.map((item) => {
    const content = buildCsvContent(item.rows, item.columnLabels);
    return `# ${item.filename}\r\n${content.replace(/^\uFEFF/, "")}`;
  });

  return new File([CSV_BOM + parts.join("\r\n\r\n")], mergedFilename, {
    type: "text/csv;charset=utf-8",
  });
}

function downloadViaAnchor(blob: Blob, filename: string): void {
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

function openBlobInNewTab(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.Telegram?.WebApp?.openLink?.(url);
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function shareFiles(files: File[], title: string): Promise<boolean> {
  if (!canShareFiles(files)) return false;
  try {
    await navigator.share({ files, title });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return false;
  }
}

/** Export one or more CSV files; uses Share sheet on mobile/Telegram. */
export async function exportCsvItems(
  items: CsvExportItem[],
  mergedFilename?: string
): Promise<{ count: number; method: CsvExportMethod }> {
  if (items.length === 0) return { count: 0, method: "download" };

  const files = items.map(csvFileFromItem);
  const useMobileFlow = isMobileExportContext() || isInsideTelegramClient();

  if (useMobileFlow) {
    if (await shareFiles(files, "TangoDB export")) {
      return { count: files.length, method: "share" };
    }

    const merged = mergeCsvExportItems(
      items,
      mergedFilename ?? (items.length === 1 ? items[0].filename : "tangodb_export.csv")
    );

    if (await shareFiles([merged], "TangoDB export")) {
      return { count: items.length, method: "share" };
    }

    openBlobInNewTab(merged);
    return { count: items.length, method: "open-tab" };
  }

  for (let i = 0; i < files.length; i++) {
    downloadViaAnchor(files[i], items[i].filename);
    if (i < files.length - 1) await delay(350);
  }

  return { count: files.length, method: "download" };
}

/** Колонки: ключ → заголовок в CSV (русский) */
export async function downloadCsv(
  rows: Record<string, string | number | null | undefined>[],
  filename: string,
  columnLabels?: Record<string, string>
): Promise<CsvExportMethod> {
  const result = await exportCsvItems([{ rows, filename, columnLabels }]);
  return result.method;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
