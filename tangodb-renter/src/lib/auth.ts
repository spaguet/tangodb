import type { Session } from "@supabase/supabase-js";
import { getSupabaseConfig } from "./supabase";

export type MintResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
};

export async function mintRenterSession(initData: string): Promise<MintResponse> {
  const { url, anonKey } = getSupabaseConfig();
  const response = await fetch(`${url}/functions/v1/renter-telegram-auth`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({ init_data: initData }),
  });

  let payload: MintResponse & { error?: string };
  try {
    payload = (await response.json()) as MintResponse & { error?: string };
  } catch {
    throw new Error("authForbidden");
  }

  if (!response.ok || !payload.access_token || !payload.refresh_token) {
    throw new Error(payload.error ?? "authForbidden");
  }

  return payload;
}

export function assertRenterSession(
  session: Session,
  expectedOrganizationId: string
): void {
  const meta = session.user.app_metadata ?? {};
  if (meta.actor !== "renter") {
    throw new Error("authNotRenter");
  }
  const orgId = meta.organization_id != null ? String(meta.organization_id) : "";
  if (!orgId || orgId !== expectedOrganizationId) {
    throw new Error("authOrgMismatch");
  }
}

export type BootstrapData = {
  studioName: string;
  timezone: string;
  currencyCode: string;
  locale: string;
  chatUrl: string | null;
  addonActive: boolean;
  botStarted: boolean;
  allowsWrite: boolean;
};

export async function fetchBootstrap(
  supabase: ReturnType<typeof import("./supabase").getRenterSupabase>
): Promise<BootstrapData> {
  const { data, error } = await supabase.rpc("renter_bootstrap");
  if (error) throw new Error("bootstrapFailed");

  const result = data as Record<string, unknown> | null;
  if (!result?.success) {
    throw new Error(String(result?.error ?? "bootstrapFailed"));
  }

  const chatUrl = result.chat_url != null ? String(result.chat_url) : null;

  return {
    studioName: String(result.studio_name ?? ""),
    timezone: String(result.timezone ?? "UTC"),
    currencyCode: String(result.currency_code ?? "RUB"),
    locale: String(result.locale ?? "ru"),
    chatUrl: chatUrl && chatUrl.length > 0 ? chatUrl : null,
    addonActive: Boolean(result.addon_active),
    botStarted: Boolean(result.bot_started),
    allowsWrite: Boolean(result.allows_write),
  };
}

export function prepareTelegramWebApp(): void {
  const webApp = window.Telegram?.WebApp;
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  webApp.requestWriteAccess?.();
}
