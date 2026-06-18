import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, KeyRound, Shield } from "lucide-react";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useOrganization } from "../../organization/OrganizationProvider";
import { supabase } from "../../lib/supabase";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const STATUS_LABELS: Record<string, { label: string; tone: string }> = {
  demo_active: { label: "Демо (активно)", tone: "text-indigo-700 bg-indigo-50 border-indigo-100" },
  demo_retention: { label: "Демо (только просмотр)", tone: "text-amber-800 bg-amber-50 border-amber-100" },
  licensed: { label: "Лицензия (пожизненно)", tone: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  suspended: { label: "Приостановлено", tone: "text-slate-600 bg-slate-100 border-slate-200" },
  purged: { label: "Данные удалены", tone: "text-slate-500 bg-slate-50 border-slate-200" },
};

export default function LicenseSettingsPage() {
  const toast = useToast();
  const { organization, orgLoading, refreshOrganization } = useOrganization();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (orgLoading || !organization) return <LoadingState label="Загрузка лицензии..." />;

  const statusInfo = STATUS_LABELS[organization.status] ?? STATUS_LABELS.suspended;
  const isLicensed = organization.status === "licensed";
  const isDemo = organization.status === "demo_active" || organization.status === "demo_retention";

  const handleActivate = async (e: React.FormEvent) => {
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
      setKey("");
      toast(data.upgraded ? "Лицензия активирована, данные сохранены" : "Лицензия активирована", "success");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Не удалось активировать ключ";
      setError(message === "Invalid access key" ? "Неверный или уже использованный ключ" : message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Лицензия</h2>
        <p className="text-xs text-slate-500 mt-1">Статус доступа к CRM и активация lifetime-ключа.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4">
        <div className={`flex items-start gap-3 rounded-lg border px-3 py-3 ${statusInfo.tone}`}>
          {isLicensed ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
          ) : isDemo && organization.status === "demo_retention" ? (
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
          ) : (
            <Shield className="w-5 h-5 shrink-0 mt-0.5" />
          )}
          <div className="space-y-1 text-sm">
            <p className="font-semibold">{statusInfo.label}</p>
            {organization.demo_expires_at && isDemo && organization.status === "demo_active" && (
              <p className="text-xs opacity-80">Демо до {formatDate(organization.demo_expires_at)}</p>
            )}
            {organization.data_purge_at && isDemo && (
              <p className="text-xs opacity-80">Данные будут удалены {formatDate(organization.data_purge_at)}</p>
            )}
            {isLicensed && (
              <p className="text-xs opacity-80">Обновления внутри версии CRM — бесплатно.</p>
            )}
          </div>
        </div>

        {!isLicensed && (
          <RequirePermission action="license.activate" mode="hide">
            <form onSubmit={handleActivate} className="space-y-3 border-t border-slate-100 pt-4">
              <p className="text-xs text-slate-500 flex items-start gap-2">
                <KeyRound className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                Введите лицензионный ключ для перехода на пожизненный доступ или апгрейда демо.
              </p>
              {error && (
                <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">{error}</p>
              )}
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="TDB-LIFE-XXXX-XXXX-XXXX"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 text-sm"
              />
              <button
                type="submit"
                disabled={loading || !key.trim()}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg cursor-pointer disabled:opacity-50"
              >
                {loading ? "Активация..." : "Активировать ключ"}
              </button>
            </form>
          </RequirePermission>
        )}

        {organization.status === "demo_retention" && (
          <p className="text-xs text-slate-500">
            <Link to="/license-required" className="text-indigo-600 hover:underline">
              Подробнее о режиме только для чтения
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
