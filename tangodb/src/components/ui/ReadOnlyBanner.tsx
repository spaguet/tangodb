import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useOrganization } from "../../organization/OrganizationProvider";

export default function ReadOnlyBanner() {
  const { isReadOnly, organization } = useOrganization();

  if (!isReadOnly) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-100 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="flex items-start gap-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          {organization?.status === "demo_retention"
            ? "Демо завершено — CRM в режиме только чтения"
            : "Срок демо истёк — CRM в режиме только чтения"}
          {organization?.data_purge_at
            ? ` до удаления данных ${new Date(organization.data_purge_at).toLocaleDateString("ru-RU")}`
            : ""}
          .
        </span>
      </div>
      <Link
        to="/license-required"
        className="text-xs font-semibold uppercase tracking-wide text-amber-900 underline underline-offset-2 shrink-0"
      >
        Активировать лицензию
      </Link>
    </div>
  );
}
