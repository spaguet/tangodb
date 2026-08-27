import { isDeveloper } from "../_shared/devAuth.ts";
import {
  getClientIp,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import {
  buildIlikeOrFilter,
  sanitizePostgrestSearchTerm,
} from "../_shared/postgrestSearch.ts";
import { checkRateLimit } from "../_shared/rateLimit.ts";
import { createServiceClient, createUserClient, logEvent } from "../_shared/supabase.ts";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 15 * 60_000;
const PAYMENT_REF_RE = /^[A-Z0-9]{6,10}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isEmailLikeSearch(term: string): boolean {
  if (term.includes("@")) return true;
  if (term.length < 3) return false;
  return /^[a-zA-Z0-9._+-]+$/.test(term);
}

type OrgRow = {
  id: string;
  name: string;
  slug: string | null;
  status: string;
  demo_expires_at: string | null;
  data_purge_at: string | null;
  created_at: string;
  owner_user_id: string | null;
  payment_ref: string | null;
  access_key_id: string | null;
  schema_version_locked: boolean;
  crm_product_versions: { code: string } | { code: string }[] | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401, req);
  }

  const clientIp = getClientIp(req);
  if (!(await checkRateLimit(`dev-console-tenants:ip:${clientIp}`, RATE_LIMIT, RATE_WINDOW_MS))) {
    return jsonResponse({ error: "Too many requests" }, 429, req);
  }

  const userClient = createUserClient(authHeader);
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user || !isDeveloper(userData.user, authHeader)) {
    return jsonResponse({ error: "developer_access_required" }, 403, req);
  }

  let body: {
    query?: string;
    status?: string;
    expiring_soon?: boolean;
    awaiting_payment?: boolean;
    limit?: number;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const q = sanitizePostgrestSearchTerm(body.query ?? "");
  const status = (body.status ?? "").trim();
  const expiringSoon = body.expiring_soon === true;
  const awaitingPayment = body.awaiting_payment === true;
  const limit = Math.min(Math.max(body.limit ?? 50, 1), 100);

  const admin = createServiceClient();

  const isUuidQuery = UUID_RE.test(q);

  let ownerUserIds: string[] | null = null;
  let orgIdsFromOwnerMembers: string[] | null = null;

  if (!isUuidQuery && isEmailLikeSearch(q)) {
    const { data: ids, error: emailError } = await admin.rpc("dev_console_user_ids_by_email", {
      p_query: q,
    });
    if (emailError) {
      logEvent("dev_console_tenants_email_error", { code: emailError.code ?? "unknown" });
      return jsonResponse({ error: "Search failed" }, 500, req);
    }
    ownerUserIds = (ids ?? []) as string[];
    if (ownerUserIds.length === 0) {
      return jsonResponse({ ok: true, tenants: [] }, 200, req);
    }

    const { data: memberRows, error: memberError } = await admin
      .from("organization_members")
      .select("organization_id")
      .in("user_id", ownerUserIds)
      .eq("role", "owner")
      .eq("is_active", true);

    if (memberError) {
      logEvent("dev_console_tenants_member_error", { code: memberError.code ?? "unknown" });
      return jsonResponse({ error: "Search failed" }, 500, req);
    }

    orgIdsFromOwnerMembers = [
      ...new Set((memberRows ?? []).map((r: { organization_id: string }) => r.organization_id)),
    ];
  }

  let query = admin
    .from("organizations")
    .select(
      "id, name, slug, status, demo_expires_at, data_purge_at, created_at, owner_user_id, payment_ref, access_key_id, schema_version_locked, crm_version_id, crm_product_versions(code)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) query = query.eq("status", status);

  if (isUuidQuery) {
    query = query.eq("id", q);
  } else if (ownerUserIds && ownerUserIds.length > 0) {
    const orParts = [`owner_user_id.in.(${ownerUserIds.join(",")})`];
    if (orgIdsFromOwnerMembers && orgIdsFromOwnerMembers.length > 0) {
      orParts.push(`id.in.(${orgIdsFromOwnerMembers.join(",")})`);
    }
    query = query.or(orParts.join(","));
  } else if (q) {
    const ref = q.toUpperCase();
    if (PAYMENT_REF_RE.test(ref)) {
      query = query.eq("payment_ref", ref);
    } else {
      const ilikeFilter = buildIlikeOrFilter(["name", "slug", "payment_ref"], q);
      if (ilikeFilter) query = query.or(ilikeFilter);
    }
  }

  if (expiringSoon) {
    const now = new Date();
    const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    query = query
      .not("demo_expires_at", "is", null)
      .gte("demo_expires_at", now.toISOString())
      .lte("demo_expires_at", in7.toISOString());
  }

  if (awaitingPayment) {
    query = query.not("payment_ref", "is", null).in("status", ["demo_active", "demo_retention"]);
  }

  const { data, error } = await query;

  if (error) {
    logEvent("dev_console_tenants_error", { code: error.code ?? "unknown" });
    return jsonResponse({ error: "Search failed" }, 500, req);
  }

  const orgRows = (data ?? []) as OrgRow[];
  const orgIds = orgRows.map((r) => r.id);
  const keyIds = orgRows.map((r) => r.access_key_id).filter(Boolean) as string[];
  const ownerIds = [...new Set(orgRows.map((r) => r.owner_user_id).filter(Boolean))] as string[];

  const [licensesRes, keysRes, storageResults, ownerUsers] = await Promise.all([
    orgIds.length
      ? admin.from("organization_licenses").select("organization_id, license_type").in("organization_id", orgIds)
      : Promise.resolve({ data: [] }),
    keyIds.length
      ? admin.from("access_keys").select("id, key_type, status, activated_at, email").in("id", keyIds)
      : Promise.resolve({ data: [] }),
    Promise.all(
      orgIds.map(async (orgId) => {
        const { data: storage } = await admin.rpc("estimate_org_storage", { p_org_id: orgId });
        return { orgId, storage };
      })
    ),
    Promise.all(
      ownerIds.map(async (userId) => {
        const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(userId);
        if (authErr || !authUser.user) return { userId, email: null, lastSignIn: null, telegramId: null };
        const meta = authUser.user.app_metadata as Record<string, unknown>;
        const tg = meta?.telegram_id;
        return {
          userId,
          email: authUser.user.email ?? null,
          lastSignIn: authUser.user.last_sign_in_at ?? null,
          telegramId: typeof tg === "number" || typeof tg === "string" ? String(tg) : null,
        };
      })
    ),
  ]);

  const licenseByOrg = new Map(
    (licensesRes.data ?? []).map((l: { organization_id: string; license_type: string }) => [
      l.organization_id,
      l.license_type,
    ])
  );
  const keyById = new Map(
    (keysRes.data ?? []).map((k: { id: string; key_type: string; status: string; activated_at: string | null; email: string | null }) => [
      k.id,
      k,
    ])
  );
  const storageByOrg = new Map(storageResults.map(({ orgId, storage }) => [orgId, storage]));
  const ownerById = new Map(ownerUsers.map((o) => [o.userId, o]));

  const { data: ownerNames } = orgIds.length
    ? await admin
        .from("organization_members")
        .select("organization_id, display_name")
        .in("organization_id", orgIds)
        .eq("role", "owner")
        .eq("is_active", true)
    : { data: [] };

  const ownerNameByOrg = new Map(
    (ownerNames ?? []).map((m: { organization_id: string; display_name: string | null }) => [
      m.organization_id,
      m.display_name,
    ])
  );

  const tenants = orgRows.map((row) => {
    const version = row.crm_product_versions;
    const code = Array.isArray(version) ? version[0]?.code : version?.code;
    const owner = row.owner_user_id ? ownerById.get(row.owner_user_id) : undefined;
    const keyMeta = row.access_key_id ? keyById.get(row.access_key_id) : undefined;
    const licenseType = licenseByOrg.get(row.id);
    const storage = storageByOrg.get(row.id) as
      | { total_rows?: number; estimated_bytes?: number }
      | undefined;

    let licenseBadge = "Demo";
    if (row.status === "licensed" && licenseType === "lifetime") licenseBadge = "Lifetime";
    else if (row.status === "licensed" && licenseType === "subscription") licenseBadge = "Subscription";
    else if (row.status === "licensed") licenseBadge = "Licensed";

    const demoExpires = row.demo_expires_at ? new Date(row.demo_expires_at) : null;
    const daysLeft =
      demoExpires && demoExpires > new Date()
        ? Math.ceil((demoExpires.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;

    const tgRaw = owner?.telegramId ?? null;
    const telegramMasked = tgRaw
      ? `…${tgRaw.slice(-4)}`
      : null;

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      demo_expires_at: row.demo_expires_at,
      demo_days_left: daysLeft,
      data_purge_at: row.data_purge_at,
      created_at: row.created_at,
      crm_version_code: code ?? null,
      schema_version_locked: row.schema_version_locked,
      payment_ref: row.payment_ref,
      owner_email: owner?.email ?? null,
      owner_display_name: ownerNameByOrg.get(row.id) ?? null,
      owner_user_id: row.owner_user_id,
      last_sign_in_at: owner?.lastSignIn ?? null,
      telegram_masked: telegramMasked,
      license_badge: licenseBadge,
      storage_rows: storage?.total_rows ?? 0,
      storage_display: formatBytes(storage?.estimated_bytes ?? 0),
      key_metadata: keyMeta
        ? {
            key_type: keyMeta.key_type,
            status: keyMeta.status,
            activated_at: keyMeta.activated_at,
            recipient_email: keyMeta.email,
          }
        : null,
    };
  });

  return jsonResponse({ ok: true, tenants }, 200, req);
});
