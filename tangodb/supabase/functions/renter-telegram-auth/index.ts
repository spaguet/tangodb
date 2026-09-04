/**
 * Mini App auth: HMAC initData → GoTrue session (actor=renter).
 * verify_jwt=false. CORS = RENTER_MINIAPP_ORIGIN only (not ALLOWED_ORIGINS).
 */

import { getClientIp } from "../_shared/http.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import {
  handleRenterMiniappOptions,
  renterMiniappJsonResponse,
} from "../_shared/renterMiniappHttp.ts";
import { createServiceClient, logEvent } from "../_shared/supabase.ts";
import { generateSecurePassword } from "../_shared/securePassword.ts";
import {
  byteaToUint8Array,
  decryptTelegramBotToken,
  loadTelegramTokenKey,
} from "../_shared/telegramToken.ts";
import {
  extractVerifiedInitData,
  getNonPrivateLaunchError,
  runDummyHmac,
  verifyInitDataWithBotToken,
  buildDisplayName,
  validateStartParam,
} from "../_shared/telegramInitData.ts";

const GENERIC_ERROR = "renter.auth.forbidden";
const GROUP_LAUNCH_ERROR = "renter.auth.groupLaunchForbidden";
const MAX_BODY_BYTES = 48_000;
const IP_RATE_LIMIT = 60;
const IP_RATE_WINDOW_MS = 60_000;
const TG_RATE_LIMIT = 30;
const TG_RATE_WINDOW_MS = 60_000;

type MintBody = {
  init_data?: string;
};

function randomRenterEmail(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const local = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${local}@users.invalid`;
}

async function issueSession(
  admin: ReturnType<typeof createServiceClient>,
  email: string,
  password?: string
): Promise<{ access_token: string; refresh_token: string; expires_in: number } | null> {
  if (password) {
    const { data, error } = await admin.auth.signInWithPassword({ email, password });
    if (error || !data.session) return null;
    return {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in ?? 3600,
    };
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const hashed = linkData?.properties?.hashed_token;
  if (linkError || !hashed) return null;

  const { data: otpData, error: otpError } = await admin.auth.verifyOtp({
    token_hash: hashed,
    type: "email",
  });
  if (otpError || !otpData.session) return null;

  return {
    access_token: otpData.session.access_token,
    refresh_token: otpData.session.refresh_token,
    expires_in: otpData.session.expires_in ?? 3600,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleRenterMiniappOptions(req);
  if (req.method !== "POST") {
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 405, req);
  }

  const contentLength = Number(req.headers.get("Content-Length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 413, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`renter-auth:ip:${clientIp}`, IP_RATE_LIMIT, IP_RATE_WINDOW_MS))) {
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 429, req);
  }

  let body: MintBody;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) {
      return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 413, req);
    }
    body = JSON.parse(raw) as MintBody;
  } catch {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const initData = (body.init_data ?? "").trim();
  if (!initData) {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const admin = createServiceClient();
  const preParams = new URLSearchParams(initData);
  const orgIdCandidate = validateStartParam(preParams.get("start_param"));
  if (!orgIdCandidate || !preParams.get("hash")) {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const { data: channelData, error: channelError } = await admin.rpc(
    "renter_telegram_mint_channel",
    { p_org_id: orgIdCandidate }
  );

  if (channelError || !channelData?.success) {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const encKey = await loadTelegramTokenKey();
  if (!encKey) {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 503, req);
  }

  const tokenBytes = byteaToUint8Array(channelData.encrypted_bot_token_hex);
  if (!tokenBytes) {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  let botToken: string;
  try {
    botToken = await decryptTelegramBotToken(encKey, tokenBytes);
  } catch {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const verified = await verifyInitDataWithBotToken(initData, botToken);
  if (!verified.ok) {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const groupLaunchError = getNonPrivateLaunchError(verified.params);
  if (groupLaunchError) {
    return renterMiniappJsonResponse({ error: GROUP_LAUNCH_ERROR }, 403, req);
  }

  const parsed = extractVerifiedInitData(verified.params, verified.hash);
  if (!parsed || parsed.organizationId !== orgIdCandidate) {
    await runDummyHmac();
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const orgId = parsed.organizationId;
  const telegramId = String(parsed.user.id);

  if (
    !(await checkRateLimit(
      `renter-auth:tg:${orgId}:${telegramId}`,
      TG_RATE_LIMIT,
      TG_RATE_WINDOW_MS
    ))
  ) {
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 429, req);
  }

  await admin.rpc("_renter_prune_init_data_hashes");

  const displayName = buildDisplayName(parsed.user);
  const { data: prepareData, error: prepareError } = await admin.rpc(
    "renter_telegram_mint_prepare",
    {
      p_payload: {
        organization_id: orgId,
        telegram_id: telegramId,
        display_name: displayName,
        init_data_hash: verified.hash,
        allows_write_to_pm: parsed.allowsWriteToPm,
      },
    }
  );

  if (prepareError || !prepareData?.success) {
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const renterId = String(prepareData.renter_id);
  let authUserId = prepareData.auth_user_id
    ? String(prepareData.auth_user_id)
    : null;
  const needsCreateUser = Boolean(prepareData.needs_create_user);
  let oneTimePassword: string | undefined;

  const appMetadata = {
    actor: "renter",
    organization_id: orgId,
    renter_id: renterId,
    telegram_id: telegramId,
  };

  if (needsCreateUser) {
    oneTimePassword = generateSecurePassword(24);
    const email = randomRenterEmail();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: oneTimePassword,
      email_confirm: true,
      app_metadata: appMetadata,
    });

    if (createError || !created.user) {
      logEvent("renter_auth_create_user_error", {
        code: createError?.code ?? "unknown",
      });
      return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
    }

    authUserId = created.user.id;

    const { data: bindData } = await admin.rpc("renter_telegram_mint_bind_auth", {
      p_payload: {
        organization_id: orgId,
        telegram_id: telegramId,
        auth_user_id: authUserId,
      },
    });

    if (!bindData?.bound) {
      const existingWinner = bindData?.existing_auth_user_id
        ? String(bindData.existing_auth_user_id)
        : null;

      if (existingWinner) {
        await admin.auth.admin.deleteUser(created.user.id);
        authUserId = existingWinner;
        oneTimePassword = undefined;
      } else {
        const { data: existing } = await admin
          .from("renters")
          .select("auth_user_id")
          .eq("organization_id", orgId)
          .eq("telegram_id", telegramId)
          .maybeSingle();

        const winnerId = existing?.auth_user_id as string | null;
        if (winnerId) {
          await admin.auth.admin.deleteUser(created.user.id);
          authUserId = winnerId;
          oneTimePassword = undefined;
        } else {
          await admin.auth.admin.deleteUser(created.user.id);
          return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
        }
      }
    }
  } else if (authUserId) {
    await admin.auth.admin.updateUserById(authUserId, {
      app_metadata: appMetadata,
    });
  }

  if (!authUserId) {
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const { data: userRow } = await admin.auth.admin.getUserById(authUserId);
  const email = userRow?.user?.email;
  if (!email) {
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  const session = await issueSession(admin, email, oneTimePassword);
  if (!session) {
    return renterMiniappJsonResponse({ error: GENERIC_ERROR }, 401, req);
  }

  return renterMiniappJsonResponse(
    {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: "bearer",
    },
    200,
    req
  );
});
