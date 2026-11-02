/**
 * Sign web-bundle manifest JSON (Ed25519). Private key only in env / local file — never commit.
 *
 * Usage:
 *   set CRM_WEB_BUNDLE_MANIFEST_PRIVATE_KEY_PEM=... (PKCS#8 PEM)
 *   node scripts/sign-crm-web-bundle-manifest.mjs dist-crm-web-bundle/latest.unsigned.json
 *
 * Writes sibling latest.json with signature field.
 */
import { createSign, createPrivateKey } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1).replace(/\\n/g, "\n");
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

function canonicalPayload(manifest) {
  const copy = { ...manifest };
  delete copy.signature;
  const keys = Object.keys(copy).sort();
  const sorted = {};
  for (const key of keys) sorted[key] = copy[key];
  return JSON.stringify(sorted);
}

const inputPath = resolve(process.argv[2] ?? "");
if (!inputPath || !existsSync(inputPath)) {
  console.error("Usage: node scripts/sign-crm-web-bundle-manifest.mjs path/to/latest.unsigned.json");
  process.exit(1);
}

const pem = process.env.CRM_WEB_BUNDLE_MANIFEST_PRIVATE_KEY_PEM?.trim();
if (!pem) {
  console.error("CRM_WEB_BUNDLE_MANIFEST_PRIVATE_KEY_PEM is not set.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(inputPath, "utf8"));
const payload = canonicalPayload(manifest);
const key = createPrivateKey(pem);
const signature = createSign("sha256").update(payload).end().sign(key);
manifest.signature = signature.toString("base64");

const outName = basename(inputPath).includes("unsigned")
  ? joinSafe(dirname(inputPath), "latest.json")
  : inputPath;

function joinSafe(dir, name) {
  return resolve(dir, name);
}

writeFileSync(outName, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Signed manifest:", outName);
