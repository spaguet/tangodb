import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { useOrganization } from "../organization/OrganizationProvider";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
} from "./AuthLayout";

export default function ActivateKeyPage() {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { memberships, organizationId, refreshOrganization } = useOrganization();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasMembership = memberships.length > 0;
  const crmPath = !hasMembership ? null : organizationId ? "/" : "/select-organization";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("activate-access-key", {
        body: { key: key.trim() },
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
        throw new Error(data?.error ?? "Не удалось активировать ключ");
      }

      await supabase.auth.refreshSession();
      await refreshOrganization();

      if (data.upgraded) {
        navigate("/", { replace: true });
      } else {
        navigate("/onboarding", { replace: true });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось активировать ключ";
      setError(message === "Invalid access key" ? "Неверный или уже использованный ключ" : message);
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
            Подписка Stripe (месяц/год) оформляется позже в{" "}
            <strong className="text-slate-600">Настройки → Лицензия</strong>, когда организация уже создана.
          </li>
        </ul>
      </div>

      <AuthError message={error} />

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label="Ключ доступа"
          value={key}
          onChange={setKey}
          placeholder="TDB-DEMO-XXXX-XXXX-XXXX"
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
