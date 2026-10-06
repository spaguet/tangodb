import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { LICENSE_PURCHASE_PATH } from "../../lib/crmLicensePurchase";
import type { ProductEdition } from "../../lib/orgEdition";
import { btnAddCls } from "../ui/buttonStyles";

export default function EditionUpsellScreen({
  requiredEdition,
}: {
  requiredEdition: ProductEdition;
}) {
  const { t } = useI18n();
  const isPro = requiredEdition === "pro";

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs py-16 px-6 text-center max-w-lg mx-auto space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-indigo-50 flex items-center justify-center text-indigo-600">
          <Sparkles className="w-6 h-6" />
        </div>
        <h1 className="text-lg font-semibold text-slate-900">
          {isPro ? t("edition.upsell.proTitle") : t("edition.upsell.studioTitle")}
        </h1>
        <p className="text-sm text-slate-600">
          {isPro ? t("edition.upsell.proBody") : t("edition.upsell.studioBody")}
        </p>
        <Link to={LICENSE_PURCHASE_PATH} className={`${btnAddCls} inline-flex`}>
          {isPro ? t("edition.cta.upgradePro") : t("edition.cta.upgradeStudio")}
        </Link>
      </div>
    </div>
  );
}
