import { useMutation } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

interface ActivateAccessKeyResult {
  ok: boolean;
  upgraded?: boolean;
  error?: string;
}

export function useActivateAccessKey() {
  return useMutation({
    mutationFn: async (key: string) => {
      const { data, error } = await supabase.functions.invoke("activate-access-key", {
        body: { key: key.trim() },
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

      const payload = data as ActivateAccessKeyResult;
      if (!payload?.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "activation_failed");
      }

      await supabase.auth.refreshSession();
      return payload;
    },
  });
}
