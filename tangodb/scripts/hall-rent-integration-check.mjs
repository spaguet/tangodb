/**
 * Hall-rent integration regression (final audit prompt).
 * Runs JWT helper + SQL tests against linked Supabase (or DATABASE_URL via psql).
 *
 * Usage: node scripts/hall-rent-integration-check.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const SQL_TESTS = [
  "venue_cost_rules_test.sql",
  "rental_series_tariffs_test.sql",
  "rental_effective_amount_test.sql",
  "rental_money_register_test.sql",
  "rental_payment_corrections_test.sql",
  "rental_operation_date_test.sql",
  "rental_invoices_advances_ui_test.sql",
  "rental_fiscal_documents_test.sql",
  "rental_cancellation_financial_test.sql",
  "rental_amount_adjustment_test.sql",
  "rental_tariff_price_lookup_test.sql",
  "rental_payment_inbox_test.sql",
  "rental_create_cash_gate_test.sql",
];

function runSql(file, useLinked) {
  const rel = `supabase/tests/${file}`.replace(/\\/g, "/");
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    return { ok: false, output: `missing file: ${rel}` };
  }

  if (process.env.DATABASE_URL) {
    const result = spawnSync("psql", [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-f", abs], {
      encoding: "utf8",
      cwd: root,
      shell: process.platform === "win32",
    });
    const output = (result.stdout || "") + (result.stderr || "");
    return { ok: result.status === 0, output };
  }

  if (!useLinked) {
    return { ok: false, output: "Set DATABASE_URL or link Supabase project (supabase link)" };
  }

  const cmd = `npx supabase db query --linked -f "${rel}"`;
  const result = spawnSync(cmd, { encoding: "utf8", cwd: root, shell: true });
  const output = (result.stdout || "") + (result.stderr || "");
  return { ok: result.status === 0, output };
}

function main() {
  const nodeChecks = [
    "test:rbac",
    "test:venue-cost-preview",
    "test:rental-effective-amount",
    "test:finance-rental-aggregates",
    "test:rental-tariff-pricing",
    "test:rental-payment-inbox",
    "test:rental-tariff-archive",
    "test:rental-tariff-rules",
    "test:rental-billing-profile",
  ];

  const failures = [];

  for (const script of nodeChecks) {
    process.stdout.write(`\n=== npm run ${script} ===\n`);
    const result = spawnSync("npm", ["run", script], { encoding: "utf8", cwd: root, shell: true });
    const output = (result.stdout || "") + (result.stderr || "");
    if (output.trim()) process.stdout.write(output);
    if (result.status !== 0) failures.push(`npm run ${script}`);
  }

  process.stdout.write("\n=== SQL: _hall_rent_test_jwt.sql ===\n");
  const jwt = runSql("_hall_rent_test_jwt.sql", true);
  if (!jwt.ok) {
    console.error(jwt.output);
    failures.push("SQL _hall_rent_test_jwt.sql");
  }

  for (const file of SQL_TESTS) {
    process.stdout.write(`\n=== SQL: ${file} ===\n`);
    const result = runSql(file, true);
    if (!result.ok) {
      console.error(result.output.slice(-4000));
      failures.push(`SQL ${file}`);
    } else {
      process.stdout.write(`${file}: ok\n`);
    }
  }

  if (failures.length) {
    console.error(`\nhall-rent-integration-check FAILED (${failures.length}):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }

  console.log("\nhall-rent-integration-check: all checks passed");
}

main();
