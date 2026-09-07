/**
 * Print HMAC for DEV_CONSOLE_ISSUER_SIGNATURE setup.
 * Usage: node scripts/hash-issuer-signature.mjs "your passphrase"
 * Requires ACCESS_KEY_PEPPER in tangodb/.env.local (or env).
 */
import { createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.local", ".env"]) {
  const path = resolve(root, name);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = val;
  }
}

const passphrase = process.argv.slice(2).join(" ").trim().normalize("NFC");
const pepper = process.env.ACCESS_KEY_PEPPER;

if (!passphrase) {
  console.error("Usage: node scripts/hash-issuer-signature.mjs \"your passphrase\"");
  process.exit(1);
}
if (!pepper) {
  console.error("ACCESS_KEY_PEPPER is not set (tangodb/.env.local or env).");
  process.exit(1);
}

const hash = createHmac("sha256", pepper).update(`issuer:${passphrase}`, "utf8").digest("hex");

console.log("Plaintext secret (recommended):");
console.log(`  npx supabase secrets set DEV_CONSOLE_ISSUER_SIGNATURE="${passphrase.replace(/"/g, '\\"')}"`);
console.log("");
console.log("Or store pre-computed HMAC in secret:");
console.log(`  npx supabase secrets set DEV_CONSOLE_ISSUER_SIGNATURE=${hash}`);
