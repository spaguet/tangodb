import type { User } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
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
 * 4. ensureTelegramUser never creates a second account when telegram_id is already linked.
 */

interface ActiveMembership {
  organization_id: string;
  member_id: string;
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
  const target = String(telegramId);
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const existing = data.users.find(
      (u) => (u.app_metadata as Record<string, unknown> | undefined)?.telegram_id === target
    );
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

async function syncTelegramMetadata(
  admin: ReturnType<typeof createServiceClient>,
  user: User,
  telegramId: number
): Promise<void> {
  const currentTg = (user.app_metadata as Record<string, unknown> | undefined)?.telegram_id;
  if (currentTg === String(telegramId)) return;

  const { error } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: {
      ...(user.app_metadata ?? {}),
      telegram_id: String(telegramId),
      provider: "telegram",
    },
    user_metadata: {
      ...(user.user_metadata ?? {}),
      telegram_id: telegramId,
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

  let body: { initData?: string; widgetPayload?: WidgetPayload };
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

  let user: User | null;
  try {
    user = await resolveTelegramUser(admin, telegramId);
  } catch (err) {
    logEvent("telegram_auth_error", {
      request_id: requestId,
      stage: "resolve_user",
      message: err instanceof Error ? err.message : "unknown",
    });
    return jsonResponse({ error: "Authentication failed" }, 500, req);
  }

  if (!user?.email) {
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
    logEvent("telegram_auth_rejected", { request_id: requestId, reason: "not_member" });
    return jsonResponse({ error: "Forbidden" }, 403, req);
  }

  try {
    await syncTelegramMetadata(admin, user, telegramId);
  } catch (err) {
    logEvent("telegram_auth_error", {
      request_id: requestId,
      stage: "metadata",
      message: err instanceof Error ? err.message : "unknown",
    });
    return jsonResponse({ error: "Authentication failed" }, 500, req);
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
    auth_mode: body.initData ? "mini_app" : "widget",
  });

  return jsonResponse(
    {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      needs_org_picker: needsOrgPicker,
    },
    200,
    req
  );
});
