/**
 * Minimal Supabase-compatible gateway: /rest/v1 → PostgREST, /auth/v1 → local password auth.
 * No Docker. For laptop dev only.
 */
import http from "node:http";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const PSQL = process.env.PSQL_PATH ?? "C:\\pgsql\\bin\\psql.exe";
const DB_PORT = process.env.LOCAL_DB_PORT ?? "5433";
const API_PORT = Number(process.env.LOCAL_API_PORT ?? "54321");
const API_HOST = process.env.LOCAL_API_HOST ?? "0.0.0.0";
const POSTGREST = process.env.POSTGREST_URL ?? "http://127.0.0.1:54341";
const JWT_SECRET =
  process.env.LOCAL_JWT_SECRET ??
  "super-secret-jwt-token-with-at-least-32-characters-long";

const refreshStore = new Map();

function psqlQuery(sql) {
  const res = spawnSync(
    PSQL,
    ["-h", "127.0.0.1", "-p", DB_PORT, "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", sql],
    {
      encoding: "utf8",
      env: { ...process.env, PGPASSWORD: "postgres", PGSSLMODE: "disable" },
    },
  );
  if (res.status !== 0) {
    throw new Error(res.stderr?.trim() || "psql failed");
  }
  return res.stdout.trim();
}

function psqlJson(sql) {
  const out = psqlQuery(`SELECT row_to_json(t) FROM (${sql}) t`);
  if (!out) return null;
  return JSON.parse(out);
}

function b64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function signJwt(payload) {
  const header = { alg: "HS256", typ: "JWT" };
  const h = b64urlJson(header);
  const p = b64urlJson(payload);
  const sig = crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

function escapeSqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildSession(userRow) {
  const now = Math.floor(Date.now() / 1000);
  const baseClaims = {
    aud: "authenticated",
    exp: now + 3600,
    iat: now,
    sub: userRow.id,
    email: userRow.email,
    phone: userRow.phone ?? "",
    app_metadata: userRow.raw_app_meta_data ?? {},
    user_metadata: userRow.raw_user_meta_data ?? {},
    role: "authenticated",
    aal: "aal1",
    amr: [{ method: "password", timestamp: now }],
    session_id: crypto.randomUUID(),
  };
  const hookSql = `SELECT custom_access_token_hook(jsonb_build_object('claims', ${escapeSqlLiteral(
    JSON.stringify(baseClaims),
  )}::jsonb)) AS hook`;
  const hook = psqlJson(hookSql);
  const claims = hook?.hook?.claims ?? baseClaims;
  const access_token = signJwt(claims);
  const refresh_token = crypto.randomBytes(32).toString("hex");
  refreshStore.set(refresh_token, { userId: userRow.id, exp: now + 60 * 60 * 24 * 7 });
  return {
    access_token,
    refresh_token,
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: "bearer",
    user: toGoTrueUser(userRow),
  };
}

const USER_SELECT = `
  id::text AS id,
  COALESCE(aud, 'authenticated') AS aud,
  COALESCE(role, 'authenticated') AS role,
  email,
  phone,
  raw_app_meta_data,
  raw_user_meta_data,
  email_confirmed_at,
  confirmed_at,
  last_sign_in_at,
  created_at,
  updated_at,
  is_anonymous,
  is_sso_user
`;

function toGoTrueUser(row) {
  const emailConfirmedAt = row.email_confirmed_at ?? null;
  return {
    id: row.id,
    aud: row.aud || "authenticated",
    role: row.role || "authenticated",
    email: row.email,
    phone: row.phone ?? "",
    email_confirmed_at: emailConfirmedAt,
    phone_confirmed_at: row.phone_confirmed_at ?? null,
    confirmed_at: row.confirmed_at ?? emailConfirmedAt,
    last_sign_in_at: row.last_sign_in_at ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    app_metadata: row.raw_app_meta_data ?? {},
    user_metadata: row.raw_user_meta_data ?? {},
    is_anonymous: row.is_anonymous === true,
    is_sso_user: row.is_sso_user === true,
  };
}

function loginWithPassword(email, password) {
  const emailLit = escapeSqlLiteral(email.trim().toLowerCase());
  const passLit = escapeSqlLiteral(password);
  const sql = `
    SELECT ${USER_SELECT}
    FROM auth.users
    WHERE lower(email) = lower(${emailLit})
      AND encrypted_password = crypt(${passLit}, encrypted_password)
      AND deleted_at IS NULL
    LIMIT 1
  `;
  const row = psqlJson(sql);
  if (!row) return null;
  return buildSession(row);
}

function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function userFromAccessToken(authHeader) {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? "");
  if (!m) return null;
  const payload = decodeJwtPayload(m[1]);
  if (!payload?.sub) return null;
  const sql = `
    SELECT ${USER_SELECT}
    FROM auth.users WHERE id = ${escapeSqlLiteral(payload.sub)}::uuid AND deleted_at IS NULL LIMIT 1
  `;
  const row = psqlJson(sql);
  if (!row) return null;
  return toGoTrueUser(row);
}

function refreshSession(refreshToken) {
  const entry = refreshStore.get(refreshToken);
  if (!entry || entry.exp < Math.floor(Date.now() / 1000)) return null;
  const sql = `
    SELECT ${USER_SELECT}
    FROM auth.users WHERE id = ${escapeSqlLiteral(entry.userId)}::uuid AND deleted_at IS NULL LIMIT 1
  `;
  const row = psqlJson(sql);
  if (!row) return null;
  refreshStore.delete(refreshToken);
  return buildSession(row);
}

function corsHeaders(req, extra = {}) {
  return {
    "Access-Control-Allow-Origin": req.headers.origin ?? "*",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Expose-Headers": "content-range, content-profile, prefer, retry-after",
    Vary: "Origin",
    ...extra,
  };
}

async function proxy(req, res, targetBase, stripPrefix) {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let path = url.pathname;
  if (stripPrefix && path.startsWith(stripPrefix)) {
    path = path.slice(stripPrefix.length) || "/";
  }
  const target = `${targetBase}${path}${url.search}`;
  const skipIn = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive"]);
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null || skipIn.has(key.toLowerCase())) continue;
    headers[key] = value;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const method = req.method ?? "GET";
  const canHaveBody = method !== "GET" && method !== "HEAD";

  const upstream = await fetch(target, {
    method,
    headers,
    body: canHaveBody && body.length ? body : undefined,
  });

  const skipOut = new Set([
    "connection",
    "keep-alive",
    "transfer-encoding",
    "content-encoding",
    "content-length",
    "access-control-allow-origin",
    "access-control-allow-credentials",
  ]);
  const outHeaders = corsHeaders(req);
  for (const [key, value] of upstream.headers.entries()) {
    if (skipOut.has(key.toLowerCase())) continue;
    outHeaders[key] = value;
  }
  const buf = Buffer.from(await upstream.arrayBuffer());
  outHeaders["Content-Length"] = String(buf.length);
  res.writeHead(upstream.status, outHeaders);
  res.end(buf);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(
      204,
      corsHeaders(req, {
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers":
          req.headers["access-control-request-headers"] ??
          "authorization, apikey, content-type, prefer, x-client-info, accept-profile, content-profile",
      }),
    );
    res.end();
    return;
  }

  if (url.pathname.startsWith("/rest/v1/") || url.pathname === "/rest/v1") {
    await proxy(req, res, POSTGREST, "/rest/v1");
    return;
  }

  if (url.pathname === "/auth/v1/user" && req.method === "GET") {
    try {
      const user = userFromAccessToken(req.headers.authorization);
      if (!user) {
        res.writeHead(401, corsHeaders(req, { "Content-Type": "application/json" }));
        res.end(JSON.stringify({ error: "invalid_token" }));
        return;
      }
      res.writeHead(200, corsHeaders(req, { "Content-Type": "application/json" }));
      res.end(JSON.stringify(user));
    } catch (e) {
      res.writeHead(500, corsHeaders(req, { "Content-Type": "application/json" }));
      res.end(JSON.stringify({ error: "server_error", message: String(e.message ?? e) }));
    }
    return;
  }

  if (url.pathname === "/auth/v1/token" && req.method === "POST") {
    try {
      const grant = url.searchParams.get("grant_type");
      const body = await readJsonBody(req);
      let session = null;
      if (grant === "password") {
        session = loginWithPassword(body.email, body.password);
      } else if (grant === "refresh_token") {
        session = refreshSession(body.refresh_token);
      }
      if (!session) {
        res.writeHead(
          400,
          corsHeaders(req, { "Content-Type": "application/json" }),
        );
        res.end(JSON.stringify({ error: "invalid_grant", error_description: "Invalid login credentials" }));
        return;
      }
      res.writeHead(200, corsHeaders(req, { "Content-Type": "application/json" }));
      res.end(JSON.stringify(session));
    } catch (e) {
      res.writeHead(500, corsHeaders(req, { "Content-Type": "application/json" }));
      res.end(JSON.stringify({ error: "server_error", message: String(e.message ?? e) }));
    }
    return;
  }

  if (url.pathname.startsWith("/functions/v1/")) {
    res.writeHead(501, corsHeaders(req, { "Content-Type": "application/json" }));
    res.end(JSON.stringify({ error: "edge_functions_disabled_locally" }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(API_PORT, API_HOST, () => {
  console.log(`[local-api] http://${API_HOST === "0.0.0.0" ? "127.0.0.1" : API_HOST}:${API_PORT} (rest→${POSTGREST})`);
});
