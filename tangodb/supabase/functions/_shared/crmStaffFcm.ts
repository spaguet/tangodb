/**
 * FCM HTTP v1 send (service account JSON in FCM_SERVICE_ACCOUNT_JSON — never in APK).
 */

import { logEvent } from "./supabase.ts";

type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

let cachedToken: { value: string; expMs: number } | null = null;

function parseServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function base64Url(data: Uint8Array): string {
  const str = btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const cleaned = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binary,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && cachedToken.expMs > now + 60_000) {
    return cachedToken.value;
  }

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = base64Url(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        sub: sa.client_email,
        aud: "https://oauth2.googleapis.com/token",
        iat,
        exp,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
      })
    )
  );
  const unsigned = `${header}.${claim}`;
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = `${unsigned}.${base64Url(new Uint8Array(signature))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    logEvent("fcm_token_error", { status: res.status });
    return null;
  }

  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedToken = {
    value: json.access_token,
    expMs: now + (json.expires_in ?? 3600) * 1000,
  };
  return json.access_token;
}

export type FcmSendResult = "sent" | "invalid_token" | "failed";

export async function sendFcmToToken(
  token: string,
  title: string,
  body: string,
  data: Record<string, string>
): Promise<FcmSendResult> {
  const sa = parseServiceAccount();
  if (!sa) {
    logEvent("fcm_config_missing", {});
    return "failed";
  }

  const accessToken = await getAccessToken(sa);
  if (!accessToken) return "failed";

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          token,
          notification: { title, body },
          data,
          android: { priority: "high" },
        },
      }),
    }
  );

  if (res.ok) return "sent";

  const text = await res.text();
  if (res.status === 404 || text.includes("UNREGISTERED") || text.includes("INVALID_ARGUMENT")) {
    return "invalid_token";
  }

  logEvent("fcm_send_error", { status: res.status, body: text.slice(0, 200) });
  return "failed";
}

export function fcmPushTitle(eventKind: string): string {
  switch (eventKind) {
    case "lesson_cancelled":
      return "TangoDB · отмена";
    case "lesson_rescheduled":
      return "TangoDB · перенос";
    case "lesson_substitute":
      return "TangoDB · замена";
    default:
      return "TangoDB";
  }
}
