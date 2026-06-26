import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { hasManualPaymentContent, parseManualPaymentConfig, type ManualPaymentConfig } from "../lib/paymentConfig";

export const platformPaymentConfigQueryKey = ["platform-payment-config"] as const;

async function fetchPlatformPaymentConfig(): Promise<ManualPaymentConfig> {
  const { data, error } = await supabase
    .from("platform_payment_methods")
    .select("config")
    .eq("id", 1)
    .maybeSingle();

  if (error) throw error;
  return parseManualPaymentConfig(data?.config);
}

export function usePlatformPaymentConfig(enabled = true) {
  const query = useQuery({
    queryKey: platformPaymentConfigQueryKey,
    queryFn: fetchPlatformPaymentConfig,
    enabled,
    staleTime: 5 * 60_000,
  });

  const config = query.data ?? {};
  const hasContent = hasManualPaymentContent(config);

  return {
    ...query,
    config,
    hasContent,
  };
}
