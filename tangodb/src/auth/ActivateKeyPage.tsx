import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { supabase } from "../lib/supabase";
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
  const { refreshOrganization } = useOrganization();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      <div className="flex items-start gap-3 text-sm text-slate-500 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
        <KeyRound className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
        <p>
          Введите демо- или лицензионный ключ. Для демо email аккаунта должен совпадать с email заявки.
        </p>
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

      <p className="text-sm text-slate-500 text-center">
        <AuthLink to="/">В CRM</AuthLink>
      </p>
    </AuthLayout>
  );
}
