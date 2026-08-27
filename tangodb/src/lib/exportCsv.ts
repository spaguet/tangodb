import { supabase } from "./supabase";
import {
  downloadFileViaTelegram,
  hasTelegramDownloadFile,
  isInsideTelegramClient,
} from "./telegram";

const CSV_SEPARATOR = ";";
const CSV_BOM = "\uFEFF";

/** Prefix formula-like cells so Excel/LibreOffice do not execute on open (M33 / S21). */
const CSV_FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function escapeCsvCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  const isFormulaLike = CSV_FORMULA_PREFIX_RE.test(str);
  const needsQuotes = isFormulaLike || /[;"\n\r]/.test(str);
  const body = str.replace(/"/g, '""');
  const escaped = isFormulaLike ? `'${body}` : body;
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
export type CsvSaveResult = "shared" | "telegram" | "clipboard" | "failed" | "cancelled";

export interface CsvExportItem {
  rows: Record<string, string | number | null | undefined>[];
  filename: string;
  columnLabels?: Record<string, string>;
}

export interface CsvManualSave {
  filename: string;
  content: string;
}

export interface CsvExportResult {
  count: number;
  method: CsvExportMethod;
  manualSave?: CsvManualSave;
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

function sanitizeStorageFilename(filename: string): string {
  return filename.replace(/[^\w.\-]/g, "_").replace(/_+/g, "_") || "export.csv";
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

async function uploadCsvSignedUrl(content: string, filename: string): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const safeName = sanitizeStorageFilename(filename);
  const path = `${user.id}/${Date.now()}_${safeName}`;
  const blob = createCsvBlob(content);

  const { error: uploadError } = await supabase.storage.from("exports").upload(path, blob, {
    contentType: "text/csv;charset=utf-8",
    upsert: true,
  });
  if (uploadError) return null;

  const { data, error: signError } = await supabase.storage.from("exports").createSignedUrl(path, 300);
  if (signError || !data?.signedUrl) return null;

  window.setTimeout(() => {
    void supabase.storage.from("exports").remove([path]);
  }, 120_000);

  return data.signedUrl;
}

export async function copyCsvToClipboard(content: string): Promise<boolean> {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

/** Save CSV from a direct user tap (Telegram download / Share / clipboard). */
export async function saveCsvFromUserGesture(content: string, filename: string): Promise<CsvSaveResult> {
  if (isInsideTelegramClient() && hasTelegramDownloadFile()) {
    const signedUrl = await uploadCsvSignedUrl(content, filename);
    if (signedUrl) {
      const started = await downloadFileViaTelegram(signedUrl, filename);
      if (started) return "telegram";
    }
  }

  const file = createCsvFile(content, filename);

  if (file) {
    const shared = await tryShareFiles([file]);
    if (shared === "shared") return "shared";
    if (shared === "cancelled") return "cancelled";
  }

  const sharedText = await tryShareText(content, filename);
  if (sharedText === "shared") return "shared";
  if (sharedText === "cancelled") return "cancelled";

  if (await copyCsvToClipboard(content)) return "clipboard";

  return "failed";
}

/** Export one or more CSV files; on mobile opens manual save sheet. */
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
  const useMobileFlow = isMobileExportContext();

  if (useMobileFlow) {
    return {
      count: items.length,
      method: "manual",
      manualSave: { filename: merged.filename, content: merged.content },
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
        manualSave: { filename: merged.filename, content: merged.content },
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

/** Column key → localized CSV header (via exportCsvI18n). */
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
