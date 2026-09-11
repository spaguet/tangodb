import { useMutation } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { PlatformPaymentSku } from "../lib/paymentConfig";

interface CreatePurchaseQuoteInput {
  organizationId: string;
  sku: PlatformPaymentSku;
  methodCode: string;
}

export interface CreatePurchaseQuoteResult {
  quote_id: string;
  amount: string;
  currency: string;
  expires_at: string;
}

export function useCreatePurchaseQuote() {
  return useMutation({
    mutationFn: async (input: CreatePurchaseQuoteInput): Promise<CreatePurchaseQuoteResult> => {
      const { data, error } = await supabase.functions.invoke("create-purchase-quote", {
        body: {
          organization_id: input.organizationId,
          sku: input.sku,
          method_code: input.methodCode,
        },
      });

      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          try {
            const payload = (await ctx.json()) as { error?: string };
            if (payload.error) throw new Error(payload.error);
          } catch (parseError) {
            if (parseError instanceof Error && parseError.message !== error.message) {
              throw parseError;
            }
          }
        }
        throw error;
      }

      const payload = data as CreatePurchaseQuoteResult & { ok?: boolean; error?: string };
      if (!payload?.ok || !payload.quote_id) {
        throw new Error(payload?.error ?? "quote_create_failed");
      }
      return payload;
    },
  });
}
