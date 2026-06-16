/**
 * Validates CSV generation and download helper prerequisites (no DOM).
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(__dirname, "../src/lib/exportCsv.ts"), "utf8");

function escapeCsvCell(value) {
  const str = value == null ? "" : String(value);
  const needsQuotes = /[;"\n\r]/.test(str);
  const escaped = str.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function buildCsvContent(rows, columnLabels) {
  const columns = columnLabels ? Object.keys(columnLabels) : rows.length > 0 ? Object.keys(rows[0]) : [];
  const headerLine = columns.map((key) => escapeCsvCell(columnLabels?.[key] ?? key)).join(";");
  const dataLines = rows.map((row) => columns.map((key) => escapeCsvCell(row[key])).join(";"));
  return "\uFEFF" + [headerLine, ...dataLines].join("\r\n");
}

const sample = buildCsvContent(
  [{ id: "1", name: 'Иван; "Петров"' }],
  { id: "ID", name: "Имя" }
);

if (!sample.startsWith("\uFEFF")) {
  console.error("FAIL: missing UTF-8 BOM");
  process.exit(1);
}

if (!sample.includes('"Иван; ""Петров"""')) {
  console.error("FAIL: CSV escaping broken", sample);
  process.exit(1);
}

if (!source.includes("document.body.appendChild(link)")) {
  console.error("FAIL: downloadCsv must append link to DOM");
  process.exit(1);
}

if (!source.includes("navigator.share")) {
  console.error("FAIL: mobile export must use Web Share API");
  process.exit(1);
}

if (!source.includes("saveCsvFromUserGesture")) {
  console.error("FAIL: export must support user-gesture save");
  process.exit(1);
}

if (!source.includes("downloadFileViaTelegram")) {
  console.error("FAIL: Telegram downloadFile integration missing");
  process.exit(1);
}

console.log("OK: export CSV content and download hook validated");
