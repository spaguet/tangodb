import { logEvent } from "./supabase.ts";

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
}

export async function sendTransactionalEmail(params: SendEmailParams): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY")?.trim();
  const from = Deno.env.get("EMAIL_FROM")?.trim() ?? "TangoDB <noreply@tangodb.app>";

  if (!apiKey) {
    logEvent("email_skipped", { reason: "missing_resend_api_key" });
    return false;
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [params.to],
        subject: params.subject,
        text: params.text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      logEvent("email_send_failed", {
        status: res.status,
        detail_length: detail.length,
      });
      return false;
    }

    logEvent("email_sent", { recipient_domain: params.to.split("@")[1] ?? "unknown" });
    return true;
  } catch (err) {
    logEvent("email_send_error", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return false;
  }
}
