/**
 * Pack Vite dist/ into a zip for Capacitor web-bundle OTA (A6).
 * Usage: npm run build && node scripts/pack-crm-web-bundle.mjs
 * Output: dist-crm-web-bundle/tangodb-web-bundle-<hash>.zip + manifest stub JSON
 */
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { platform } from "node:os";
import { pipeline } from "node:stream/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "dist");
const outDir = join(root, "dist-crm-web-bundle");

if (!existsSync(distDir)) {
  console.error("Run npm run build first (missing dist/).");
  process.exit(1);
}

function zipDistContents(sourceDir, zipPath) {
  rmSync(zipPath, { force: true });
  if (platform() === "win32") {
    const ps = [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${sourceDir.replace(/'/g, "''")}\\*' -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
    ];
    const res = spawnSync("powershell.exe", ps, { stdio: "inherit" });
    if (res.status !== 0) process.exit(res.status ?? 1);
    return;
  }
  const res = spawnSync("zip", ["-r", "-q", zipPath, "."], { cwd: sourceDir, stdio: "inherit" });
  if (res.status !== 0) {
    console.error("zip command failed (install zip on Linux/macOS).");
    process.exit(res.status ?? 1);
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

mkdirSync(outDir, { recursive: true });
const stagingZip = join(outDir, "bundle-staging.zip");
zipDistContents(distDir, stagingZip);

const zipBytes = readFileSync(stagingZip);
const sha256 = createHash("sha256").update(zipBytes).digest("hex");
const bundleHash = sha256.slice(0, 16);
const finalName = `tangodb-web-bundle-${bundleHash}.zip`;
const finalPath = join(outDir, finalName);
writeFileSync(finalPath, zipBytes);
rmSync(stagingZip, { force: true });

const appVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const updateOrigin = (process.env.VITE_CRM_APK_UPDATE_ORIGIN || "https://updates.tangodb.app").replace(/\/$/, "");
const stub = {
  appVersion,
  bundleHash,
  bundleUrl: `${updateOrigin}/android/web-bundle/${finalName}`,
  sha256,
  releaseNotes: "",
  signature: "",
};

writeFileSync(join(outDir, "latest.unsigned.json"), `${JSON.stringify(stub, null, 2)}\n`);
writeFileSync(join(outDir, "sha256.txt"), `${sha256}  ${finalName}\n`);

console.log("Wrote", finalPath);
console.log("sha256:", sha256);
console.log("bundleHash:", bundleHash);
console.log("Next: node scripts/sign-crm-web-bundle-manifest.mjs dist-crm-web-bundle/latest.unsigned.json");
