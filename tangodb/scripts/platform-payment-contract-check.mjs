/**
 * Contract tests: CRM parse/resolve + Dev Console round-trip + Edge module parity hook.
 * Run: npm run test:platform-payment-contract
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const nodeTest = spawnSync("npx", ["tsx", "--test", "src/lib/platformPaymentContract.test.ts"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});

if (nodeTest.status !== 0) {
  process.exit(nodeTest.status ?? 1);
}

const crmSource = readFileSync(join(root, "src/lib/platformPaymentContract.ts"), "utf8");
const edgeSource = readFileSync(
  join(root, "supabase/functions/_shared/platformPaymentContract.ts"),
  "utf8"
);

const normalize = (source) =>
  source
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\r\n/g, "\n")
    .trim();

assert.equal(
  normalize(edgeSource),
  normalize(crmSource),
  "Edge _shared/platformPaymentContract.ts must stay in sync with src/lib/platformPaymentContract.ts"
);

console.log("platform-payment-contract-check: OK");
