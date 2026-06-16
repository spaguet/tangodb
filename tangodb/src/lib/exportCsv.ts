const CSV_SEPARATOR = ";";
const CSV_BOM = "\uFEFF";

function escapeCsvCell(value: unknown): string {
  const str = value == null ? "" : String(value);
  const needsQuotes = /[;"\n\r]/.test(str);
  const escaped = str.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** Колонки: ключ → заголовок в CSV (русский) */
export function downloadCsv(
  rows: Record<string, string | number | null | undefined>[],
  filename: string,
  columnLabels?: Record<string, string>
): void {
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

  const content = CSV_BOM + [headerLine, ...dataLines].join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
