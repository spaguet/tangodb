import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useCrmSubscriptionUi } from "../../hooks/useCrmSubscriptionUi";
import { useI18n } from "../../hooks/useI18n";
import { btnAddCls } from "../ui/buttonStyles";

export default function CrmSubscriptionRenewalBanner() {
  const { t, formatDateTime } = useI18n();
  const { showTMinus7Banner, periodEnd, purchasePath } = useCrmSubscriptionUi();

  if (!showTMinus7Banner || !periodEnd) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-100 px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
      <div className="flex items-start gap-2 text-sm text-amber-900">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          {t("license.renewal.tMinus7Title")}{" "}
          {t("license.renewal.tMinus7Body", { date: formatDateTime(periodEnd) })}
        </span>
      </div>
      <Link to={purchasePath} className={`${btnAddCls} shrink-0`}>
        {t("license.plan.renewCta")}
      </Link>
    </div>
  );
}
