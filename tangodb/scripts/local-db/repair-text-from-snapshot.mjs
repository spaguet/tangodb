/**
 * Restore text columns from pg_dump COPY blocks (UTF-8 source of truth).
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";

const PSQL = process.env.PSQL_PATH ?? "C:\\pgsql\\bin\\psql.exe";
const DB_PORT = process.env.LOCAL_DB_PORT ?? "5433";

const snapshotArg = process.argv[2];
const defaultSnapshot = "D:\\TangoDB\\local-crm-db\\backups\\latest\\data_public.sql";
const snapshotPath = path.resolve(snapshotArg ?? defaultSnapshot);

const tableFilter = new Set(
  (process.env.LOCAL_REPAIR_TABLES ?? "clients")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

if (!fs.existsSync(snapshotPath)) {
  console.error(`Snapshot not found: ${snapshotPath}`);
  process.exit(1);
}

function splitCopyFields(line) {
  const out = [];
  let cur = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "\\") {
      i++;
      if (i >= line.length) break;
      const esc = line[i];
      if (esc === "n") cur += "\n";
      else if (esc === "t") cur += "\t";
      else if (esc === "r") cur += "\r";
      else if (esc === "b") cur += "\b";
      else if (esc === "f") cur += "\f";
      else if (esc === "v") cur += "\v";
      else cur += esc;
      continue;
    }
    if (ch === "\t") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((v) => (v === "\\N" ? null : v));
}

function escapeCopyField(value) {
  if (value === null) return "\\N";
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

function psqlQuery(sql) {
  const res = spawnSync(
    PSQL,
    ["-h", "127.0.0.1", "-p", DB_PORT, "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: "postgres", PGSSLMODE: "disable" },
    },
  );
  if (res.status !== 0) {
    throw new Error(res.stderr?.trim() || "psql failed");
  }
  return res.stdout.trim();
}

function psqlFile(filePath) {
  const res = spawnSync(
    PSQL,
    ["-h", "127.0.0.1", "-p", DB_PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", filePath],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: "postgres", PGSSLMODE: "disable" },
    },
  );
  if (res.status !== 0) {
    throw new Error(res.stderr?.trim() || res.stdout?.trim() || "psql failed");
  }
}

const metaRows = psqlQuery(`
  SELECT c.table_name || '|' || c.column_name
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND c.data_type IN ('text', 'character varying')
    AND c.table_name = ANY (ARRAY[${[...tableFilter].map((t) => `'${t}'`).join(",")}])
  ORDER BY 1;
`)
  .split("\n")
  .map((line) => line.replace(/\r$/, ""))
  .filter(Boolean);

const textColumnsByTable = new Map();
for (const row of metaRows) {
  const [table, column] = row.split("|");
  if (!textColumnsByTable.has(table)) textColumnsByTable.set(table, []);
  textColumnsByTable.get(table).push(column);
}

const rowsByTable = new Map();
for (const table of tableFilter) rowsByTable.set(table, []);

const rl = readline.createInterface({
  input: fs.createReadStream(snapshotPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

let inCopy = false;
let copyTable = "";
let copyColumns = [];

for await (const line of rl) {
  const trimmed = line.replace(/\r$/, "");
  const copyMatch = trimmed.match(/^COPY public\.([a-z0-9_]+) \((.+)\) FROM stdin;/i);
  if (copyMatch) {
    inCopy = tableFilter.has(copyMatch[1]);
    copyTable = copyMatch[1];
    copyColumns = copyMatch[2].split(",").map((s) => s.trim());
    continue;
  }
  if (inCopy && trimmed === "\\.") {
    inCopy = false;
    copyTable = "";
    copyColumns = [];
    continue;
  }
  if (!inCopy || !copyTable) continue;

  const textCols = textColumnsByTable.get(copyTable);
  if (!textCols?.length || !copyColumns.includes("id")) continue;

  const fields = splitCopyFields(trimmed);
  const row = {};
  copyColumns.forEach((col, idx) => {
    row[col] = fields[idx] ?? null;
  });
  if (!row.id) continue;
  rowsByTable.get(copyTable)?.push(row);
}

let total = 0;
const logsDir = process.env.LOCAL_DB_LOGS ?? "D:\\TangoDB\\local-crm-db\\logs";
fs.mkdirSync(logsDir, { recursive: true });

for (const [table, rows] of rowsByTable) {
  if (!rows.length) continue;
  const textCols = textColumnsByTable.get(table);
  if (!textCols?.length) continue;

  const repairCols = ["id", ...textCols];
  const tsvPath = path.join(logsDir, `repair_${table}.tsv`);
  const lines = rows.map((row) => repairCols.map((col) => escapeCopyField(row[col] ?? null)).join("\t"));
  fs.writeFileSync(tsvPath, `${lines.join("\n")}\n`, "utf8");

  const colDefs = repairCols.map((col) => (col === "id" ? "id uuid PRIMARY KEY" : `${col} text`)).join(", ");
  const setClause = textCols.map((col) => `${col} = f.${col}`).join(", ");
  const sqlPath = path.join(logsDir, `repair_${table}.sql`);
  const tsvForPsql = tsvPath.replace(/\\/g, "/");
  fs.writeFileSync(
    sqlPath,
    `
DROP TABLE IF EXISTS pg_temp.${table}_text_fix;
CREATE TABLE pg_temp.${table}_text_fix (${colDefs});
\\copy pg_temp.${table}_text_fix (${repairCols.join(", ")}) FROM '${tsvForPsql}' WITH (FORMAT text, DELIMITER E'\\t', NULL '\\\\N', ENCODING 'UTF8');
UPDATE public.${table} AS c
SET ${setClause}
FROM pg_temp.${table}_text_fix AS f
WHERE c.id = f.id;
`,
    "utf8",
  );

  psqlFile(sqlPath);
  total += rows.length;
  console.log(`Repaired ${table}: ${rows.length} rows`);
}

console.log(`Done. ${total} rows from ${snapshotPath}`);
