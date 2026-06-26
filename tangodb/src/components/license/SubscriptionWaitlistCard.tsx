import { useState } from "react";
import { Bell, Clock } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../auth/AuthProvider";
import { useOrganization } from "../../organization/OrganizationProvider";

interface SubscriptionWaitlistCardProps {
  disabled?: boolean;
}

export default function SubscriptionWaitlistCard({ disabled }: SubscriptionWaitlistCardProps) {
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
        throw new Error(typeof data?.error === "string" ? data.error : "Не удалось сохранить заявку");
      }

      setMessage(
        data.already_registered
          ? "Вы уже в списке ожидания — мы сообщим, когда подписка станет доступна."
          : "Заявка сохранена — мы сообщим, когда подписка станет доступна."
      );
    } catch (err) {
      const text = err instanceof Error ? err.message : "Не удалось сохранить заявку";
      setError(text === "Too many requests" ? "Слишком много попыток — попробуйте позже" : text);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 border-t border-slate-100 pt-4">
      <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 space-y-2">
        <p className="text-xs text-slate-600 flex items-start gap-2">
          <Clock className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <span>
            <span className="font-semibold text-slate-700">Месячная подписка — скоро.</span> Оформление через Stripe
            пока недоступно. Оставьте email — сообщим о запуске.
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2 opacity-60 pointer-events-none select-none">
          <div className="py-2.5 bg-indigo-600/70 text-white text-xs font-semibold uppercase tracking-wider rounded-lg text-center">
            Месяц
          </div>
          <div className="py-2.5 bg-slate-800/70 text-white text-xs font-semibold uppercase tracking-wider rounded-lg text-center">
            Год
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500 flex items-start gap-2">
          <Bell className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          Список ожидания подписки
        </p>
        {error && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
        )}
        {message && (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
            {message}
          </p>
        )}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          disabled={disabled || loading}
          className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled || loading || !email.trim()}
          onClick={() => void submit()}
          className="w-full py-2.5 border border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-50"
        >
          {loading ? "Сохранение..." : "Уведомить о запуске"}
        </button>
      </div>
    </div>
  );
}
