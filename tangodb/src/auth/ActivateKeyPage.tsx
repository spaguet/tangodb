import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, ShoppingBag } from "lucide-react";
import { DEMO_PURCHASE_PATH } from "../lib/demoLicense";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

function parseActivationError(err: unknown): string {
  if (!(err instanceof Error)) return "Не удалось активировать ключ";

  const message = err.message;
  if (message === "Invalid access key") return "Неверный или уже использованный ключ";
  if (message === "Session expired") return "Сессия истекла — выйдите и войдите снова.";
  if (message === "Activation failed") {
    return "Ошибка активации на сервере. Сгенерируйте новый ключ в Dev Console и попробуйте снова.";
  }
  if (message.includes("email required")) {
    return "Привяжите email к аккаунту (Telegram) или войдите по email/паролю.";
  }
  if (message === "origin_not_allowed") {
    return "Ошибка CORS: проверьте ALLOWED_ORIGINS для URL приложения.";
  }
  if (message.includes("Edge Function")) {
    return "Сервис активации недоступен. Попробуйте позже или обновите страницу.";
  }
  return message;
}

function activationErrorFromBody(body: { error?: string; debug?: string } | null): Error | null {
  if (!body?.error) return null;
  const message = body.debug ? `${body.error}: ${body.debug}` : body.error;
  return new Error(message);
}

export default function ActivateKeyPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { memberships, organizationId, refreshOrganization } = useOrganization();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasMembership = memberships.length > 0;
  const crmPath = !hasMembership ? null : organizationId ? "/" : "/select-organization";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("activate-access-key", {
        body: { key: key.trim().replace(/\s+/g, "") },
      });

      if (fnError) {
        const ctx = (fnError as { context?: Response }).context;
        if (ctx) {
          const body = (await ctx.json().catch(() => null)) as { error?: string; debug?: string } | null;
          const parsedError = activationErrorFromBody(body);
          if (parsedError) throw parsedError;
        }
        throw fnError;
      }

      if (!data?.ok) {
        throw new Error(typeof data?.error === "string" ? data.error : "Не удалось активировать ключ");
      }

      const orgId = typeof data.organization_id === "string" ? data.organization_id : null;
      if (!orgId) {
        throw new Error("Организация не создана — попробуйте снова");
      }

      setSuccess("Ключ принят, настраиваем доступ…");
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;
      await refreshOrganization();

      navigate(data.upgraded ? "/" : "/onboarding", { replace: true });
    } catch (err) {
      setSuccess(null);
      setError(parseActivationError(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle="Активация ключа">
      <div className="space-y-3 text-sm text-slate-600">
        <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
          <KeyRound className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <p>
            После входа нужно активировать ключ — так создаётся ваша организация в CRM.
          </p>
        </div>
        <ul className="text-xs text-slate-500 space-y-1.5 list-disc pl-4">
          <li>
            <strong className="text-slate-600">Демо-ключ</strong> — email аккаунта должен совпадать с email
            заявки.
          </li>
          <li>
            <strong className="text-slate-600">Lifetime-ключ</strong> — пожизненный доступ (из письма после
            покупки).
          </li>
          <li>
            Покупка полной версии — реквизиты и инструкция на странице{" "}
            <Link to={DEMO_PURCHASE_PATH} className="text-indigo-600 hover:underline font-medium">
              «Купить полную версию»
            </Link>
            .
          </li>
          <li>
            Подписка Stripe (месяц/год) — скоро; уведомление можно оставить в{" "}
            <strong className="text-slate-600">Настройки → Лицензия</strong>.
          </li>
        </ul>
      </div>

      <AuthError message={error} />
      <AuthSuccess message={success} />

      <Link
        to={DEMO_PURCHASE_PATH}
        className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors"
      >
        <ShoppingBag className="w-4 h-4" />
        Купить полную версию
      </Link>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Ключ доступа"
          value={key}
          onChange={setKey}
          placeholder="TDB-LIFE-XXXX-XXXX-XXXX"
          required
        />
        <AuthButton loading={loading}>Активировать</AuthButton>
      </form>

      <div className="text-sm text-slate-500 text-center space-y-2">
        {crmPath ? (
          <p>
            <AuthLink to={crmPath}>В CRM</AuthLink>
          </p>
        ) : (
          <p className="text-xs">
            CRM откроется после активации ключа или принятия приглашения в команду.
          </p>
        )}
        <p>
          <AuthLink to="/accept-invite">Есть приглашение в команду?</AuthLink>
          {" · "}
          <button
            type="button"
            onClick={() => void signOut().then(() => navigate("/login", { replace: true }))}
            className="text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
          >
            Выйти
          </button>
        </p>
      </div>
    </AuthLayout>
  );
}
