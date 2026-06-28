import { useMutation } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

interface SubmitPurchaseRequestInput {
  organizationId: string;
  paymentComment: string;
  contactEmail?: string;
  contactTelegram?: string;
}

export function useSubmitPurchaseRequest() {
  return useMutation({
    mutationFn: async (input: SubmitPurchaseRequestInput) => {
      const { data, error } = await supabase.functions.invoke("submit-purchase-request", {
        body: {
          organization_id: input.organizationId,
          payment_comment: input.paymentComment,
          contact_email: input.contactEmail || undefined,
          contact_telegram: input.contactTelegram || undefined,
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

      const payload = data as { ok?: boolean; error?: string };
      if (!payload?.ok) throw new Error(payload?.error ?? "request_save_failed");
      return payload;
    },
  });
}
