export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string
): Promise<{ ok: boolean; error?: string }> {
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  if (!secret) {
    // Local/dev: skip when secret not configured
    return { ok: true };
  }

  const trimmed = token.trim();
  if (!trimmed) {
    return { ok: false, error: "missing_turnstile_token" };
  }

  const body = new URLSearchParams({
    secret,
    response: trimmed,
  });
  if (remoteIp && remoteIp !== "unknown") {
    body.set("remoteip", remoteIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    return { ok: false, error: "turnstile_verify_failed" };
  }

  const data = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
  if (!data.success) {
    return {
      ok: false,
      error: data["error-codes"]?.join(",") ?? "turnstile_rejected",
    };
  }

  return { ok: true };
}
