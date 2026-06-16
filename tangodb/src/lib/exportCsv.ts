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

/** Колонки: ключ → заголовок в CSV (русский) */
export function downloadCsv(
  rows: Record<string, string | number | null | undefined>[],
  filename: string,
  columnLabels?: Record<string, string>
): boolean {
  const content = buildCsvContent(rows, columnLabels);
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
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

  return true;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
