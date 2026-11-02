/**
 * Full CRM Android release artifacts (APK + signed manifests + web bundle).
 * Requires: npm run build inputs, Java, Android SDK.
 * Release APK: android/keystore.properties (see keystore.properties.example).
 *
 * Usage: node scripts/release-crm-android.mjs
 */
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = join(root, "dist-crm-release");
const updateOrigin = process.env.VITE_CRM_APK_UPDATE_ORIGIN?.trim() || "https://updates.tangodb.app";

function loadEnvLocal() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) return;
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

function run(cmd, args, opts = {}) {
  const shell =
    opts.shell ?? (process.platform === "win32" && (cmd === "npm" || cmd === "npx" || cmd === "gradlew.bat"));
  const res = spawnSync(cmd, args, {
    stdio: "inherit",
    cwd: opts.cwd ?? root,
    shell,
    env: opts.env ?? process.env,
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${res.status ?? res.error})`);
  }
}

function sha256File(path) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

loadEnvLocal();

if (!existsSync(join(root, "src/lib/crmWebBundle/crmWebBundleManifestPublicKey.pem"))) {
  run(process.execPath, ["scripts/generate-crm-web-bundle-keys.mjs"]);
}

const appVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
const versionCode = process.env.CRM_ANDROID_VERSION_CODE?.trim() || "8";

console.log(`Release CRM Android ${appVersion} (versionCode ${versionCode}), origin ${updateOrigin}`);

if (!process.env.CRM_WEB_BUNDLE_MANIFEST_PRIVATE_KEY_PEM) {
  run(process.execPath, ["scripts/generate-crm-web-bundle-keys.mjs"]);
  loadEnvLocal();
}

const env = { ...process.env, VITE_CRM_APK_UPDATE_ORIGIN: updateOrigin };
run("npm", ["run", "build"], { env });

run(process.execPath, ["scripts/pack-crm-web-bundle.mjs"], { env });

const unsignedManifest = join(root, "dist-crm-web-bundle/latest.unsigned.json");
if (!existsSync(unsignedManifest)) {
  throw new Error("Missing dist-crm-web-bundle/latest.unsigned.json");
}
run(process.execPath, ["scripts/sign-crm-web-bundle-manifest.mjs", unsignedManifest], { env });

run("npx", ["cap", "sync", "android"], { env });

const keystoreProps = join(root, "android/keystore.properties");
const hasReleaseKey = existsSync(keystoreProps);
const gradleTask = hasReleaseKey ? "assembleRelease" : "assembleDebug";
let builtApk = null;
let hasReleaseKeyEffective = hasReleaseKey;

try {
  if (!hasReleaseKey) {
    console.warn("android/keystore.properties missing — building DEBUG APK (not for studio rollout).");
  }
  const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  run(gradle, [gradleTask], {
    cwd: join(root, "android"),
    env: { ...env, CRM_ANDROID_VERSION_CODE: versionCode, CRM_ANDROID_VERSION_NAME: appVersion },
  });
  const apkDir = join(root, "android/app/build/outputs/apk", hasReleaseKey ? "release" : "debug");
  const apkName = hasReleaseKey ? "app-release.apk" : "app-debug.apk";
  builtApk = join(apkDir, apkName);
  if (!existsSync(builtApk)) {
    throw new Error(`APK not found: ${builtApk}`);
  }
} catch (err) {
  console.warn("Gradle APK build skipped:", err instanceof Error ? err.message : err);
  console.warn("Install JDK (JAVA_HOME) + Android SDK, add android/keystore.properties, re-run release.");
  builtApk = null;
  hasReleaseKeyEffective = false;
}

const releaseApkName = `tangodb-crm-${appVersion}.apk`;
mkdirSync(join(outRoot, "android/web-bundle"), { recursive: true });

let apkSha = "";
let apkSize = 0;
let apkUrl = `${updateOrigin}/android/${releaseApkName}`;

if (builtApk && existsSync(builtApk)) {
  copyFileSync(builtApk, join(outRoot, "android", releaseApkName));
  apkSha = sha256File(builtApk);
  apkSize = statSync(builtApk).size;
} else {
  writeFileSync(
    join(outRoot, "android/BUILD_APK.txt"),
    "APK not built on this machine. Run release-crm-android.mjs on a host with JAVA_HOME and signing keystore.\n"
  );
}

const apkManifest = {
  versionCode: Number(versionCode),
  versionName: appVersion,
  minVersionCode: 1,
  apkUrl,
  sha256: apkSha || "fill-after-apk-build",
  releaseNotes: `CRM ${appVersion} — staff app (Capacitor).`,
};

writeFileSync(join(outRoot, "android/latest.json"), `${JSON.stringify(apkManifest, null, 2)}\n`);

const signedBundleManifest = readFileSync(join(root, "dist-crm-web-bundle/latest.json"), "utf8");
writeFileSync(join(outRoot, "android/web-bundle/latest.json"), signedBundleManifest);

const bundleZipName = JSON.parse(signedBundleManifest).bundleUrl.split("/").pop();
copyFileSync(join(root, "dist-crm-web-bundle", bundleZipName), join(outRoot, "android/web-bundle", bundleZipName));

const landingPatch = {
  version: appVersion,
  date: new Date().toISOString().slice(0, 10),
  sizeBytes: apkSize,
  sha256: apkSha,
  url: apkUrl,
};

writeFileSync(join(outRoot, "landing-config.json"), `${JSON.stringify(landingPatch, null, 2)}\n`);

writeFileSync(
  join(outRoot, "UPLOAD.md"),
  `# Upload to ${updateOrigin}

Copy files from dist-crm-release/ to the update host:

| Local | Remote path |
|-------|-------------|
| android/${releaseApkName} | /android/${releaseApkName} |
| android/latest.json | /android/latest.json |
| android/web-bundle/latest.json | /android/web-bundle/latest.json |
| android/web-bundle/${bundleZipName} | /android/web-bundle/${bundleZipName} |

Merge landing-config.json into tangodb-landing/src/config.ts CRM_APK_DOWNLOAD.
`
);

console.log("\nArtifacts:", outRoot);
console.log("APK sha256:", apkSha);
