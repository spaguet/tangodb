import type { Session } from "@supabase/supabase-js";
import { Browser } from "@capacitor/browser";
import { requestOrganizationSelectionAfterLogin } from "../organization/organizationSelectionIntent";
import { setAuthRememberMe, supabase } from "./supabase";
import { requireSiteUrl } from "./siteUrl";
import {
  buildNativeAuthReturnUrl,
  buildNativeLoginPageUrl,
  parseNativeAuthReturn,
} from "./nativeAuthHandoff";

export type NativeAuthReturnResult = "ignored" | "ok" | "failed";

const CONSUMED_HASH_KEY = "tangodb:native-auth-return-hash";
const consumed = new Set<string>();
const pending = new Map<string, Promise<NativeAuthReturnResult>>();

function fingerprint(accessToken: string, refreshToken: string): string {
  const value = `${accessToken}\n${refreshToken}`;
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 33) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function alreadyConsumed(id: string): boolean {
  if (consumed.has(id)) return true;
  try {
    return sessionStorage.getItem(CONSUMED_HASH_KEY) === id;
  } catch {
    return false;
  }
}

function markConsumed(id: string): void {
  consumed.add(id);
  try {
    sessionStorage.setItem(CONSUMED_HASH_KEY, id);
  } catch {
    /* private mode */
  }
}

async function applyParsedReturn(rawUrl: string): Promise<NativeAuthReturnResult> {
  const parsed = parseNativeAuthReturn(rawUrl);
  if (!parsed) return "ignored";
  const id = fingerprint(parsed.accessToken, parsed.refreshToken);
  if (alreadyConsumed(id)) return "ignored";

  setAuthRememberMe(parsed.rememberMe);
  const { data, error } = await supabase.auth.setSession({
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
  });
  if (error || !data.session) return "failed";
  markConsumed(id);
  requestOrganizationSelectionAfterLogin(data.session.user.id);
  return "ok";
}

/** One session copy in the shell. The same URL is not applied twice. */
export function consumeNativeAuthReturn(rawUrl: string): Promise<NativeAuthReturnResult> {
  const parsed = parseNativeAuthReturn(rawUrl);
  if (!parsed) return Promise.resolve("ignored");
  const id = fingerprint(parsed.accessToken, parsed.refreshToken);
  const existing = pending.get(id);
  if (existing) return existing;
  const job = applyParsedReturn(rawUrl).finally(() => {
    pending.delete(id);
  });
  pending.set(id, job);
  return job;
}

export async function openNativeLoginInBrowser(): Promise<void> {
  await Browser.open({ url: buildNativeLoginPageUrl(requireSiteUrl()) });
}

/**
 * Leaves a single client session: local sign-out does not revoke the refresh token,
 * then the shell imports that same session.
 */
export async function returnSessionToNativeShell(session: Session, rememberMe: boolean): Promise<void> {
  if (!session.access_token || !session.refresh_token) {
    throw new Error("native_auth_return_incomplete");
  }
  const url = buildNativeAuthReturnUrl(
    { accessToken: session.access_token, refreshToken: session.refresh_token },
    rememberMe
  );
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) throw error;
  window.location.replace(url);
}
