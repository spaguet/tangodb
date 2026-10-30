/**
 * Generate EC P-256 key pair for web-bundle manifest signing.
 * Writes public key to repo paths; private key to tangodb/.env.local (gitignored).
 *
 * Usage: node scripts/generate-crm-web-bundle-keys.mjs [--force]
 */
import { generateKeyPairSync } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const force = process.argv.includes("--force");

const envLocal = resolve(root, ".env.local");
const publicPaths = [
  resolve(root, "src/lib/crmWebBundle/crmWebBundleManifestPublicKey.pem"),
  resolve(root, "android/app/src/main/assets/crm_web_bundle_manifest_public.pem"),
];

if (!force && publicPaths.every((p) => existsSync(p))) {
  const existing = readFileSync(publicPaths[0], "utf8");
  if (existing.includes("BEGIN PUBLIC KEY") && existsSync(envLocal)) {
    const envBody = readFileSync(envLocal, "utf8");
    if (envBody.includes("CRM_WEB_BUNDLE_MANIFEST_PRIVATE_KEY_PEM")) {
      console.log("Keys already present. Use --force to rotate.");
      process.exit(0);
    }
  }
}

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });

for (const p of publicPaths) {
  writeFileSync(p, publicPem);
  console.log("Wrote", p);
}

const envKey = "CRM_WEB_BUNDLE_MANIFEST_PRIVATE_KEY_PEM";
let envBody = existsSync(envLocal) ? readFileSync(envLocal, "utf8") : "";
const escaped = privatePem.replace(/\n/g, "\\n");
const line = `${envKey}="${escaped}"`;
if (new RegExp(`^${envKey}=`, "m").test(envBody)) {
  envBody = envBody.replace(new RegExp(`^${envKey}=.*$`, "m"), line);
} else {
  envBody = `${envBody.trim()}\n\n# A6 web-bundle manifest signing (never commit elsewhere)\n${line}\n`;
}
writeFileSync(envLocal, envBody);
console.log("Updated", envLocal);
