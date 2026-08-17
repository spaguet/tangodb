import { useState } from "react";
import { Bell, Clock } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthProvider";
import { useOrganization } from "../../organization/OrganizationProvider";
import { useI18n } from "../../hooks/useI18n";

interface SubscriptionWaitlistCardProps {
  disabled?: boolean;
}

export default function SubscriptionWaitlistCard({ disabled }: SubscriptionWaitlistCardProps) {
  const { t } = useI18n();
  const { session } = useAuth();
  const { organizationId } = useOrganization();
  const defaultEmail = session?.user.email ?? "";
  const [email, setEmail] = useState(defaultEmail);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("submit-subscription-waitlist", {
        body: {
          email: email.trim(),
          organization_id: organizationId ?? undefined,
        },
      });

      if (fnError) {
        const ctx = (fnError as { context?: Response }).context;
        if (ctx) {
          try {
            const body = await ctx.json();
            if (body?.error) throw new Error(body.error);
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== fnError.message) throw parseErr;
          }
        }
        throw fnError;
      }

      if (!data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : t("license.waitlist.saveError"));
      }

      setMessage(
        data.already_registered ? t("license.waitlist.alreadyRegistered") : t("license.waitlist.saved")
      );
    } catch (err) {
      const text = err instanceof Error ? err.message : t("license.waitlist.saveError");
      setError(text === "Too many requests" ? t("license.waitlist.tooManyRequests") : text);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-ink-100 pt-4">
      <div className="rounded-lg border border-dashed border-ink-200 bg-ink-50 px-3 py-3 space-y-2">
        <p className="text-xs text-ink-600 flex items-start gap-2">
          <Clock className="w-4 h-4 text-ink-500 shrink-0 mt-0.5" />
          <span>{t("license.waitlist.stripeSoon")}</span>
        </p>
        <div className="grid grid-cols-2 gap-2 opacity-60 pointer-events-none select-none">
          <div className="py-2.5 bg-gold-700 text-white text-xs font-semibold rounded-lg text-center">
            {t("license.waitlist.month")}
          </div>
          <div className="py-2.5 bg-ink-800/70 text-white text-xs font-semibold uppercase tracking-wider rounded-lg text-center">
            {t("license.waitlist.year")}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-ink-500 flex items-start gap-2">
          <Bell className="w-4 h-4 text-gold-700 shrink-0 mt-0.5" />
          {t("license.waitlist.title")}
        </p>
        {error && (
          <p className="text-xs text-garnet-600 bg-garnet-50 border border-garnet-100 rounded-lg px-3 py-2">{error}</p>
        )}
        {message && (
          <p className="text-xs text-gold-700 bg-gold-50 border border-gold-100 rounded-lg px-3 py-2">
            {message}
          </p>
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          disabled={disabled || loading}
          className="w-full bg-ink-50 border border-ink-200 rounded-lg px-3 py-2.5 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled || loading || !email.trim()}
          onClick={() => void submit()}
          className="w-full py-2.5 border border-gold-200 text-gold-700 hover:bg-gold-50 text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-50"
        >
          {loading ? t("common.saving") : t("license.waitlist.notify")}
        </button>
      </div>
    </div>
  );
}
