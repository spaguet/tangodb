import manifestPublicKeyPem from "./crmWebBundleManifestPublicKey.pem?raw";
import { canonicalWebBundleManifestPayload } from "./crmWebBundleManifestCanonical";

export { canonicalWebBundleManifestPayload };

let cachedKey: CryptoKey | null = null;

function pemToBinary(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function getWebBundleManifestPublicKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = await crypto.subtle.importKey(
    "spki",
    pemToBinary(manifestPublicKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"]
  );
  return cachedKey;
}

export async function verifyWebBundleManifestSignature(
  manifest: Record<string, unknown>,
  signatureBase64: string
): Promise<boolean> {
  const signature = Uint8Array.from(atob(signatureBase64.trim()), (c) => c.charCodeAt(0));
  const payload = new TextEncoder().encode(canonicalWebBundleManifestPayload(manifest));
  const key = await getWebBundleManifestPublicKey();
  return crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signature,
    payload
  );
}
