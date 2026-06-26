import { Link } from "react-router-dom";
import { AlertTriangle, KeyRound, ShoppingBag } from "lucide-react";
import { useOrganization } from "../organization/OrganizationProvider";
import { DEMO_PURCHASE_PATH } from "../lib/demoLicense";
import { AuthLayout, AuthLink } from "./AuthLayout";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function LicenseRequiredPage() {
  const { organization, role } = useOrganization();
  const showPurchaseCta = role === "owner" || role === "director";

  return (
    <AuthLayout title="TangoDB" subtitle="Требуется лицензия">
      <div className="flex items-start gap-3 text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-3">
        <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold">Демо-период завершён</p>
          <p>
            CRM доступна только для просмотра. Активируйте лицензионный ключ, чтобы продолжить работу.
          </p>
          {organization?.data_purge_at && (
            <p className="text-xs text-amber-700/80">
              {new Date(organization.data_purge_at) <= new Date()
                ? `Данные будут удалены в ближайшее время (запланировано ${formatDate(organization.data_purge_at)}).`
                : `Данные будут удалены ${formatDate(organization.data_purge_at)}.`}
            </p>
          )}
        </div>
      </div>

      {showPurchaseCta && (
        <Link
          to={DEMO_PURCHASE_PATH}
          className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          <ShoppingBag className="w-4 h-4" />
          Купить полную версию
        </Link>
      )}

      <Link
        to="/activate-key"
        className={`w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors ${
          showPurchaseCta
            ? "border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
            : "bg-indigo-600 text-white hover:bg-indigo-700"
        }`}
      >
        <KeyRound className="w-4 h-4" />
        Активировать лицензионный ключ
      </Link>

      <p className="text-sm text-slate-500 text-center">
        <AuthLink to="/">Вернуться в CRM (только просмотр)</AuthLink>
      </p>
    </AuthLayout>
  );
}
