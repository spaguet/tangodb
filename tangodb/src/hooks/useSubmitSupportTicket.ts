import { useMutation } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

export type SupportTicketKind = "login_help" | "forgot_password" | "license_help" | "other";

export interface SubmitSupportTicketInput {
  clientRequestId: string;
  ticketKind: SupportTicketKind;
  message: string;
  pagePath: string;
  locale?: string;
  email?: string;
  contactTelegram?: string;
  organizationId?: string;
  turnstileToken?: string | null;
}

async function parseInvokeError(error: unknown): Promise<never> {
  const err = error as { context?: Response; message?: string };
  if (err.context) {
    try {
      const payload = (await err.context.json()) as { error?: string };
      if (payload.error) throw new Error(payload.error);
    } catch (parseError) {
      if (parseError instanceof Error && parseError.message !== err.message) {
        throw parseError;
      }
    }
  }
  throw error;
}

export function useSubmitSupportTicket() {
  return useMutation({
    mutationFn: async (input: SubmitSupportTicketInput) => {
      const { data, error } = await supabase.functions.invoke("submit-support-ticket", {
        body: {
          client_request_id: input.clientRequestId,
          ticket_kind: input.ticketKind,
          message: input.message,
          page_path: input.pagePath,
          locale: input.locale,
          email: input.email,
          contact_telegram: input.contactTelegram,
          organization_id: input.organizationId,
          turnstile_token: input.turnstileToken ?? undefined,
        },
      });

      if (error) await parseInvokeError(error);

      const payload = data as { ok?: boolean; submitted?: boolean; error?: string };
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.ok && !payload?.submitted) {
        throw new Error("submit_failed");
      }
      return payload;
    },
  });
}
