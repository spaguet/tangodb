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

export type CsvExportMethod = "share" | "download" | "manual";

export interface CsvExportItem {
  rows: Record<string, string | number | null | undefined>[];
  filename: string;
  columnLabels?: Record<string, string>;
}

export interface CsvExportResult {
  count: number;
  method: CsvExportMethod;
  manualSave?: { filename: string; blobUrl: string };
}

export function isMobileExportContext(): boolean {
  if (typeof navigator === "undefined") return false;

  const tgPlatform = window.Telegram?.WebApp?.platform;
  if (tgPlatform === "ios" || tgPlatform === "android") return true;

  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;

  return navigator.maxTouchPoints > 1 && window.innerWidth < 1024;
}

function createCsvBlob(content: string): Blob {
  return new Blob([content], { type: "text/csv;charset=utf-8" });
}

function createCsvFile(content: string, filename: string): File | null {
  if (typeof File === "undefined") return null;
  try {
    return new File([content], filename, { type: "text/csv;charset=utf-8" });
  } catch {
    return null;
  }
}

function canSharePayload(data: ShareData): boolean {
  if (typeof navigator.share !== "function") return false;
  try {
    return !navigator.canShare || navigator.canShare(data);
  } catch {
    return false;
  }
}

function csvFileFromItem(item: CsvExportItem): File | null {
  return createCsvFile(buildCsvContent(item.rows, item.columnLabels), item.filename);
}

function mergeCsvExportItems(items: CsvExportItem[], mergedFilename: string): { content: string; filename: string } {
  const parts = items.map((item) => {
    const content = buildCsvContent(item.rows, item.columnLabels);
    return `# ${item.filename}\r\n${content.replace(/^\uFEFF/, "")}`;
  });

  return {
    content: CSV_BOM + parts.join("\r\n\r\n"),
    filename: mergedFilename,
  };
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

function createManualSave(blob: Blob, filename: string): CsvExportResult["manualSave"] {
  return {
    filename,
    blobUrl: URL.createObjectURL(blob),
  };
}

async function sharePayload(data: ShareData): Promise<"shared" | "failed" | "cancelled"> {
  if (!canSharePayload(data)) return "failed";
  try {
    await navigator.share(data);
    return "shared";
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    return "failed";
  }
}

async function tryShareFiles(files: File[]): Promise<"shared" | "failed" | "cancelled"> {
  if (files.length === 0) return "failed";
  return sharePayload({ files, title: "TangoDB export" });
}

async function tryShareText(content: string, title: string): Promise<"shared" | "failed" | "cancelled"> {
  const trimmed = content.length > 900_000 ? `${content.slice(0, 900_000)}\r\n…` : content;
  return sharePayload({ title, text: trimmed });
}

/** Export one or more CSV files; uses Share sheet on mobile/Telegram. */
export async function exportCsvItems(
  items: CsvExportItem[],
  mergedFilename?: string
): Promise<CsvExportResult> {
  if (items.length === 0) return { count: 0, method: "download" };

  const merged = mergeCsvExportItems(
    items,
    mergedFilename ?? (items.length === 1 ? items[0].filename : "tangodb_export.csv")
  );
  const mergedBlob = createCsvBlob(merged.content);
  const mergedFile = createCsvFile(merged.content, merged.filename);
  const useMobileFlow = isMobileExportContext();

  if (useMobileFlow) {
    if (mergedFile) {
      const shared = await tryShareFiles([mergedFile]);
      if (shared === "shared") return { count: items.length, method: "share" };
      if (shared === "cancelled") throw new DOMException("Share cancelled", "AbortError");
    }

    const files = items.map(csvFileFromItem).filter((file): file is File => file != null);
    if (files.length > 0) {
      const shared = await tryShareFiles(files);
      if (shared === "shared") return { count: items.length, method: "share" };
      if (shared === "cancelled") throw new DOMException("Share cancelled", "AbortError");
    }

    const sharedText = await tryShareText(merged.content, merged.filename);
    if (sharedText === "shared") return { count: items.length, method: "share" };
    if (sharedText === "cancelled") throw new DOMException("Share cancelled", "AbortError");

    return {
      count: items.length,
      method: "manual",
      manualSave: createManualSave(mergedBlob, merged.filename),
    };
  }

  if (isInsideTelegramClient()) {
    try {
      downloadViaAnchor(mergedBlob, merged.filename);
      return { count: items.length, method: "download" };
    } catch {
      return {
        count: items.length,
        method: "manual",
        manualSave: createManualSave(mergedBlob, merged.filename),
      };
    }
  }

  const files = items.map(csvFileFromItem).filter((file): file is File => file != null);
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

export function revokeManualSaveUrl(blobUrl: string | undefined): void {
  if (blobUrl) URL.revokeObjectURL(blobUrl);
}
