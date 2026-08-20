import { useMutation } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

interface SubmitSubscriptionWaitlistInput {
  email: string;
  organizationId?: string | null;
}

interface SubmitSubscriptionWaitlistResult {
  ok: boolean;
  already_registered?: boolean;
  error?: string;
}

export function useSubmitSubscriptionWaitlist() {
  return useMutation({
    mutationFn: async (input: SubmitSubscriptionWaitlistInput) => {
      const { data, error } = await supabase.functions.invoke("submit-subscription-waitlist", {
        body: {
          email: input.email.trim(),
          organization_id: input.organizationId ?? undefined,
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

      const payload = data as SubmitSubscriptionWaitlistResult;
      if (!payload?.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "waitlist_save_failed");
      }
      return payload;
    },
  });
}
