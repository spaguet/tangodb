import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

export const supabaseEnvError =
  !url || !anonKey
    ? "Не заданы VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — добавьте их в Vercel (Dev Console) или .env.local."
    : null;

export const supabase = createClient(url, anonKey);

function formatInvokeError(error: unknown, fnName: string): Error {
  if (!(error instanceof Error)) return new Error(`Edge Function ${fnName} failed`);

  const message = error.message;
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) {
    return new Error(
      "Не удалось вызвать Edge Function. Проверьте VITE_SUPABASE_URL на Vercel и ALLOWED_ORIGINS в Supabase Secrets (https://tangodb-dev-console.vercel.app)."
    );
  }
  return error;
}

function formatFunctionError(code: string): string {
  const map: Record<string, string> = {
    developer_access_required:
      "developer_access_required — для Dev Console нужен platform developer в Supabase Auth app_metadata или DEV_CONSOLE_ALLOWLIST. Роли owner/admin в CRM недостаточно.",
    origin_not_allowed:
      "origin_not_allowed — добавьте https://tangodb-dev-console.vercel.app в ALLOWED_ORIGINS (Supabase Secrets).",
  };
  return map[code] ?? code;
}

async function readFunctionErrorBody(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: Response }).context;
  if (!ctx) return null;
  try {
    const payload = (await ctx.json()) as { error?: string };
    return typeof payload.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}

export async function invokeDevFunction<T>(
  name: string,
  body?: Record<string, unknown>
): Promise<T> {
  if (supabaseEnvError) throw new Error(supabaseEnvError);

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) throw new Error("Not authenticated");

  const { data, error } = await supabase.functions.invoke(name, {
    body: body ?? {},
  });

  if (error) {
    const bodyError = await readFunctionErrorBody(error);
    if (bodyError) throw new Error(formatFunctionError(bodyError));
    throw formatInvokeError(error, name);
  }

  const payload = data as T & { error?: string };
  if (payload && typeof payload === "object" && payload.error) {
    throw new Error(formatFunctionError(payload.error));
  }

  return payload;
}

export async function loadPaymentConfig(): Promise<{ config: unknown; updatedAt: string | null }> {
  if (supabaseEnvError) throw new Error(supabaseEnvError);

  const { data, error } = await supabase
    .from("platform_payment_methods")
    .select("config, updated_at")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return {
    config: data?.config ?? {},
    updatedAt: data?.updated_at ?? null,
  };
}

export async function savePaymentConfig(
  config: unknown,
  expectedPricingRevision: number
): Promise<{ updatedAt: string | null; pricingRevision: number; config: unknown }> {
  const result = await invokeDevFunction<{
    updated_at: string | null;
    pricing_revision?: number;
    config?: unknown;
  }>("dev-console-payment-methods", {
    action: "update",
    config,
    expected_pricing_revision: expectedPricingRevision,
  });
  return {
    updatedAt: result.updated_at ?? null,
    pricingRevision: result.pricing_revision ?? expectedPricingRevision,
    config: result.config ?? config,
  };
}
