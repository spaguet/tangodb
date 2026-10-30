import test from "node:test";
import assert from "node:assert/strict";
import { isWebBundleManifestNewer } from "./crmWebBundleVersion.ts";

test("rejects older semver on server", () => {
  assert.equal(
    isWebBundleManifestNewer(
      { appVersion: "2.13.5", bundleHash: "a" },
      { appVersion: "2.13.6", bundleHash: "b" },
      "2.13.6"
    ),
    false
  );
});

test("accepts newer patch hash at same semver", () => {
  assert.equal(
    isWebBundleManifestNewer(
      { appVersion: "2.13.6", bundleHash: "new" },
      { appVersion: "2.13.6", bundleHash: "old" },
      "2.13.6"
    ),
    true
  );
});
