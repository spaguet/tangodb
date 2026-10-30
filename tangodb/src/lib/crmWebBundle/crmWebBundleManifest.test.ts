import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSign, createPrivateKey, createPublicKey, verify } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalWebBundleManifestPayload } from "./crmWebBundleManifestCanonical.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("canonical manifest payload is stable", () => {
  const payload = canonicalWebBundleManifestPayload({
    sha256: "abc",
    appVersion: "2.13.6",
    bundleHash: "deadbeef",
    bundleUrl: "https://updates.tangodb.app/x.zip",
    signature: "ignored",
  });
  assert.equal(
    payload,
    '{"appVersion":"2.13.6","bundleHash":"deadbeef","bundleUrl":"https://updates.tangodb.app/x.zip","sha256":"abc"}'
  );
});

test("ecdsa sign/verify roundtrip matches release tooling", () => {
  const pem = process.env.CRM_WEB_BUNDLE_MANIFEST_PRIVATE_KEY_PEM?.trim();
  if (!pem) {
    console.log("skip: CRM_WEB_BUNDLE_MANIFEST_PRIVATE_KEY_PEM not set");
    return;
  }
  const manifest = {
    appVersion: "2.13.6",
    bundleHash: "testhash",
    bundleUrl: "https://updates.tangodb.app/android/web-bundle/test.zip",
    sha256: "00",
  };
  const payload = canonicalWebBundleManifestPayload(manifest);
  const privateKey = createPrivateKey(pem);
  const signature = createSign("sha256").update(payload).end().sign(privateKey);
  const publicPem = readFileSync(
    resolve(root, "src/lib/crmWebBundle/crmWebBundleManifestPublicKey.pem"),
    "utf8"
  );
  const publicKey = createPublicKey(publicPem);
  assert.ok(verify("sha256", Buffer.from(payload, "utf8"), publicKey, signature));
});
