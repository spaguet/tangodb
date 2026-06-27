import type { User } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  generateRecoveryCode,
  hashRecoveryCode,
} from "../_shared/recoveryCode.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";
import {
  syntheticTelegramEmail,
  verifyInitData,
  verifyLoginWidget,
  type WidgetPayload,
} from "../_shared/telegramVerify.ts";

const RATE_LIMIT_IP = 10;
const RATE_LIMIT_TG = 10;
const RATE_WINDOW_MS = 60_000;

/**
 * Telegram ↔ email merge (Phase 4 invite — no duplicate auth.users):
 * 1. Admin invites teacher@school.com; user registers or signs in with email.
 * 2. On invite accept, backend sets app_metadata.telegram_id on the existing user row.
 * 3. Telegram login resolves the user via findAuthUserByTelegramId (not tg_* synthetic email).
 * 4. New Telegram ID (no linked user): synthetic auth user + self-service demo org (S2).
 */

interface ActiveMembership {
  organization_id: string;
  member_id: string;
}

interface AuthRequestBody {
  initData?: string;
  widgetPayload?: WidgetPayload;
}

function extractDisplayName(body: AuthRequestBody, telegramId: number): string {
  if (body.widgetPayload) {
    const { first_name, last_name, username } = body.widgetPayload;
    const parts = [first_name, last_name].filter(Boolean);
    if (parts.length > 0) return parts.join(" ");
    if (username) return username;
  }

  if (body.initData) {
    try {
      const params = new URLSearchParams(body.initData);
      const userRaw = params.get("user");
      if (userRaw) {
        const user = JSON.parse(userRaw) as {
          id?: number;
          first_name?: string;
          last_name?: string;
          username?: string;
        };
        if (user.id === telegramId) {
          const parts = [user.first_name, user.last_name].filter(Boolean);
          if (parts.length > 0) return parts.join(" ");
          if (user.username) return user.username;
        }
      }
    } catch {
      // ignore malformed initData user payload
    }
  }

  return "";
}

function extractUsername(body: AuthRequestBody, telegramId: number): string {
  if (body.widgetPayload?.username) return body.widgetPayload.username;

  if (body.initData) {
    try {
      const params = new URLSearchParams(body.initData);
      const userRaw = params.get("user");
      if (userRaw) {
        const user = JSON.parse(userRaw) as { id?: number; username?: string };
        if (user.id === telegramId && user.username) return user.username;
      }
    } catch {
      // ignore malformed initData user payload
    }
  }

  return "";
}

function normalizeTelegramUsername(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^t\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/, 1)[0]
    .toLowerCase();
}

function normalizeTelegramId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (typeof value !== "string") return "";

  const trimmed = value.trim();
  if (!trimmed) return "";

  const tgUrlMatch = trimmed.match(/^tg:\/\/user\?id=(\d+)$/i);
  if (tgUrlMatch) return tgUrlMatch[1];

  const withoutAt = trimmed.replace(/^@/, "");
  return /^\d+$/.test(withoutAt) ? withoutAt : "";
}

function telegramMetadataMatches(user: User, telegramId: number): boolean {
  const target = String(telegramId);
  const appMetadata = (user.app_metadata as Record<string, unknown> | undefined) ?? {};
  const userMetadata = (user.user_metadata as Record<string, unknown> | undefined) ?? {};
  return (
    normalizeTelegramId(appMetadata.telegram_id) === target ||
    normalizeTelegramId(userMetadata.telegram_id) === target
  );
}

function isSyntheticTelegramEmail(email: string, telegramId: number): boolean {
  return email.trim().toLowerCase() === syntheticTelegramEmail(telegramId).toLowerCase();
}

async function findAuthUserByEmail(
  admin: ReturnType<typeof createServiceClient>,
  email: string
): Promise<User | null> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const existing = data.users.find((u) => u.email === email);
    if (existing) return existing;
    if (data.users.length < perPage) return null;
  }
}

async function findAuthUserByTelegramId(
  admin: ReturnType<typeof createServiceClient>,
  telegramId: number
): Promise<User | null> {
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const existing = data.users.find((u) => telegramMetadataMatches(u, telegramId));
    if (existing) return existing;
    if (data.users.length < perPage) return null;
  }
}

async function resolveTelegramUser(
  admin: ReturnType<typeof createServiceClient>,
  telegramId: number
): Promise<User | null> {
  const byTelegramId = await findAuthUserByTelegramId(admin, telegramId);
  if (byTelegramId) return byTelegramId;

  const syntheticEmail = syntheticTelegramEmail(telegramId);
  return findAuthUserByEmail(admin, syntheticEmail);
}

async function findAuthUserByTeamTelegram(
  admin: ReturnType<typeof createServiceClient>,
  username: string,
  telegramId: number
): Promise<User | null> {
  const normalizedUsername = normalizeTelegramUsername(username);
  const normalizedTelegramId = String(telegramId);
  if (!normalizedUsername && !normalizedTelegramId) return null;

  const { data, error } = await admin
    .from("organization_members")
    .select("user_id, telegram")
    .eq("is_active", true)
    .not("telegram", "is", null);

  if (error) throw error;

  const matched = (data ?? []).find((row) => {
    const telegram = row.telegram as string | null;
    const rowUsername = normalizeTelegramUsername(telegram);
    const rowTelegramId = normalizeTelegramId(telegram);
    return (
      (normalizedUsername && rowUsername === normalizedUsername) ||
      (rowTelegramId && rowTelegramId === normalizedTelegramId)
    );
  });
  if (!matched?.user_id) return null;

  const { data: userData, error: userError } = await admin.auth.admin.getUserById(
    matched.user_id as string
  );
  if (userError) throw userError;
  return userData.user ?? null;
}

async function ensureSyntheticTelegramUser(
  admin: ReturnType<typeof createServiceClient>,
  telegramId: number,
  displayName: string
): Promise<User> {
  const existing = await resolveTelegramUser(admin, telegramId);
  if (existing) return existing;

  const email = syntheticTelegramEmail(telegramId);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: {
      telegram_id: String(telegramId),
      provider: "telegram",
    },
    user_metadata: {
      telegram_id: telegramId,
      ...(displayName ? { display_name: displayName } : {}),
    },
  });

  if (error) {
    const retry = await resolveTelegramUser(admin, telegramId);
    if (retry) return retry;
    throw error;
  }

  if (!data.user) throw new Error("Failed to create telegram user");
  return data.user;
}

async function syncTelegramMetadata(
  admin: ReturnType<typeof createServiceClient>,
  user: User,
  telegramId: number,
  displayName?: string
): Promise<void> {
  const currentTg = (user.app_metadata as Record<string, unknown> | undefined)?.telegram_id;
  const needsTg = currentTg !== String(telegramId);
  const currentDisplay =
    typeof user.user_metadata?.display_name === "string"
      ? user.user_metadata.display_name.trim()
      : "";
  const needsDisplay = Boolean(displayName) && !currentDisplay;

  if (!needsTg && !needsDisplay) return;

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: needsTg
      ? {
          ...(user.app_metadata ?? {}),
          telegram_id: String(telegramId),
          provider: "telegram",
        }
      : user.app_metadata,
    user_metadata: {
      ...(user.user_metadata ?? {}),
      ...(needsTg ? { telegram_id: telegramId } : {}),
      ...(needsDisplay && displayName ? { display_name: displayName } : {}),
    },
  });
  if (error) throw error;
}

async function getActiveMemberships(
  admin: ReturnType<typeof createServiceClient>,
  userId: string
): Promise<ActiveMembership[]> {
  const { data, error } = await admin
    .from("organization_members")
    .select("id, organization_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("joined_at", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row) => ({
    organization_id: row.organization_id as string,
    member_id: row.id as string,
  }));
}

async function createTelegramDemoOrg(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  telegramId: number,
  displayName: string
): Promise<{ recoveryCode: string }> {
  const recoveryCode = generateRecoveryCode();
  const recoveryCodeHash = await hashRecoveryCode(recoveryCode);

  const { data, error } = await admin.rpc("create_telegram_self_service_demo_org", {
    p_user_id: userId,
    p_telegram_id: telegramId,
    p_display_name: displayName || null,
    p_recovery_code_hash: recoveryCodeHash,
  });

  if (error) {
    const message = error.message ?? "Creation failed";
    if (message.includes("demo already used for this telegram")) {
      throw new DemoAlreadyUsedError();
    }
    if (message.includes("already has organization membership")) {
      throw new AlreadyHasOrgError();
    }
    throw error;
  }

  await admin
    .from("user_recovery_codes")
    .update({ shown_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("code_hash", recoveryCodeHash)
    .is("revoked_at", null);

  logEvent("telegram_demo_created", {
    organization_id: (data as Record<string, unknown> | null)?.organization_id ?? null,
  });

  return { recoveryCode };
}

class DemoAlreadyUsedError extends Error {
  constructor() {
    super("Demo already used for this telegram account");
    this.name = "DemoAlreadyUsedError";
  }
}

class AlreadyHasOrgError extends Error {
  constructor() {
    super("User already has organization membership");
    this.name = "AlreadyHasOrgError";
  }
}

async function setActiveOrganizationForUser(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
  membership: ActiveMembership
): Promise<void> {
  const { error } = await admin.from("user_active_organizations").upsert(
    {
      user_id: userId,
      organization_id: membership.organization_id,
      member_id: membership.member_id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );
  if (error) throw error;
}

async function issueSession(
  admin: ReturnType<typeof createServiceClient>,
  email: string
): Promise<{ access_token: string; refresh_token: string } | null> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return null;

  const linkData = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (linkData.error) {
    logEvent("telegram_auth_link_error", { code: linkData.error.code ?? "unknown" });
    return null;
  }

  const hashedToken = linkData.data?.properties?.hashed_token;
  if (!hashedToken) return null;

  const verifyRes = await fetch(`${supabaseUrl}/auth/v1/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
    },
    body: JSON.stringify({ type: "magiclink", token_hash: hashedToken }),
  });

  if (!verifyRes.ok) {
    logEvent("telegram_auth_verify_error", { status: verifyRes.status });
    return null;
  }

  const session = await verifyRes.json();
  if (!session.access_token || !session.refresh_token) return null;
  return { access_token: session.access_token, refresh_token: session.refresh_token };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const clientIp = getClientIp(req);
  if (!checkRateLimit(`telegram-auth:ip:${clientIp}`, RATE_LIMIT_IP, RATE_WINDOW_MS)) {
    logEvent("telegram_auth_rate_limited", { request_id: requestId, scope: "ip" });
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  let body: AuthRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400, req);
  }

  const telegramId = body.initData
    ? await verifyInitData(body.initData, botToken)
    : body.widgetPayload
      ? await verifyLoginWidget(body.widgetPayload, botToken)
      : null;

  if (!telegramId) {
    logEvent("telegram_auth_rejected", { request_id: requestId, reason: "invalid_signature" });
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  if (!checkRateLimit(`telegram-auth:tg:${telegramId}`, RATE_LIMIT_TG, RATE_WINDOW_MS)) {
    logEvent("telegram_auth_rate_limited", { request_id: requestId, scope: "telegram" });
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  let admin: ReturnType<typeof createServiceClient>;
  try {
    admin = createServiceClient();
  } catch {
    return jsonResponse({ error: "Service unavailable" }, 500, req);
  }

  const displayName = extractDisplayName(body, telegramId);
  const username = extractUsername(body, telegramId);
  let isNewDemo = false;
  let recoveryCode: string | undefined;

  let user: User;
  try {
    const existing =
      (await resolveTelegramUser(admin, telegramId)) ||
      (await findAuthUserByTeamTelegram(admin, username, telegramId));
    if (existing?.email) {
      user = existing;
    } else {
      user = await ensureSyntheticTelegramUser(admin, telegramId, displayName);
    }
  } catch (err) {
    logEvent("telegram_auth_error", {
      request_id: requestId,
      stage: "resolve_user",
      message: err instanceof Error ? err.message : "unknown",
    });
    return jsonResponse({ error: "Authentication failed" }, 500, req);
  }

  if (!user.email) {
    logEvent("telegram_auth_rejected", { request_id: requestId, reason: "no_account" });
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  let memberships: ActiveMembership[];
  try {
    memberships = await getActiveMemberships(admin, user.id);
  } catch (err) {
    logEvent("telegram_auth_error", {
      request_id: requestId,
      stage: "memberships",
      message: err instanceof Error ? err.message : "unknown",
    });
    return jsonResponse({ error: "Authentication failed" }, 500, req);
  }

  if (memberships.length === 0) {
    const canSelfServiceDemo = isSyntheticTelegramEmail(user.email, telegramId);

    if (!canSelfServiceDemo) {
      logEvent("telegram_auth_rejected", {
        request_id: requestId,
        reason: "not_member",
      });
      return jsonResponse({ error: "Forbidden" }, 403, req);
    }

    try {
      await syncTelegramMetadata(admin, user, telegramId, displayName);
      const demoResult = await createTelegramDemoOrg(admin, user.id, telegramId, displayName);
      recoveryCode = demoResult.recoveryCode;
      isNewDemo = true;
      memberships = await getActiveMemberships(admin, user.id);
    } catch (err) {
      if (err instanceof DemoAlreadyUsedError) {
        return jsonResponse({ error: err.message }, 409, req);
      }
      if (err instanceof AlreadyHasOrgError) {
        memberships = await getActiveMemberships(admin, user.id);
      } else {
        logEvent("telegram_auth_error", {
          request_id: requestId,
          stage: "create_demo",
          message: err instanceof Error ? err.message : "unknown",
        });
        return jsonResponse({ error: "Authentication failed" }, 500, req);
      }
    }

    if (memberships.length === 0) {
      logEvent("telegram_auth_rejected", { request_id: requestId, reason: "not_member" });
      return jsonResponse({ error: "Forbidden" }, 403, req);
    }
  } else {
    try {
      await syncTelegramMetadata(admin, user, telegramId, displayName);
    } catch (err) {
      logEvent("telegram_auth_error", {
        request_id: requestId,
        stage: "metadata",
        message: err instanceof Error ? err.message : "unknown",
      });
      return jsonResponse({ error: "Authentication failed" }, 500, req);
    }
  }

  const session = await issueSession(admin, user.email);
  if (!session) {
    return jsonResponse({ error: "Authentication failed" }, 500, req);
  }

  const needsOrgPicker = memberships.length > 1;

  if (!needsOrgPicker) {
    try {
      await setActiveOrganizationForUser(admin, user.id, memberships[0]);
    } catch (err) {
      logEvent("telegram_auth_error", {
        request_id: requestId,
        stage: "set_active_org",
        message: err instanceof Error ? err.message : "unknown",
      });
      return jsonResponse({ error: "Authentication failed" }, 500, req);
    }
  }

  logEvent("telegram_auth_success", {
    request_id: requestId,
    membership_count: memberships.length,
    needs_org_picker: needsOrgPicker,
    is_new_demo: isNewDemo,
    auth_mode: body.initData ? "mini_app" : "widget",
  });

  return jsonResponse(
    {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      needs_org_picker: needsOrgPicker,
      ...(isNewDemo ? { is_new_demo: true } : {}),
      ...(recoveryCode ? { recovery_code: recoveryCode } : {}),
    },
    200,
    req
  );
});
