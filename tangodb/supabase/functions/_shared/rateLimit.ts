import { createServiceClient, logEvent } from "./supabase.ts";

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<boolean> {
  const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
  try {
    const admin = createServiceClient();
    const { data, error } = await admin.rpc("check_edge_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      logEvent("rate_limit_rpc_error", {
        code: error.code ?? "unknown",
        message: error.message ?? "unknown",
      });
      return false;
    }
    return data === true;
  } catch (err) {
    logEvent("rate_limit_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return false;
  }
}
