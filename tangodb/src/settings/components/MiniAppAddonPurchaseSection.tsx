import { Link } from "react-router-dom";
import { Smartphone } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useLocationRentalHourRates } from "../../hooks/useLocationRentalHourRates";
import { useOrganization } from "../../organization/OrganizationProvider";
import { DEMO_PURCHASE_PATH, isDemoOrgStatus } from "../../lib/demoLicense";

export default function MiniAppAddonPurchaseSection() {
  const { t } = useI18n();
  const { organization } = useOrganization();
  const hourRatesQuery = useLocationRentalHourRates();
  const addonActive = hourRatesQuery.data?.addonActive ?? false;
  const isDemo = isDemoOrgStatus(organization?.status);

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
        <Smartphone className="w-3.5 h-3.5 text-indigo-600" />
        {t("hallRent.miniapp.purchase.title")}
      </p>
      <p className={`text-xs leading-relaxed ${addonActive ? "text-indigo-700" : "text-slate-600"}`}>
        {addonActive ? t("hallRent.miniapp.includedWithCrm") : t("hallRent.miniapp.addonOff")}
      </p>
      {addonActive ? (
        <p className="text-[10px] text-slate-500 leading-relaxed">
          {t("hallRent.miniapp.includedHint")}
        </p>
      ) : null}
      {!addonActive && isDemo ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 leading-relaxed">
          {t("hallRent.miniapp.purchase.demoBlocked")}{" "}
          <Link to={DEMO_PURCHASE_PATH} className="font-semibold text-indigo-700 hover:underline">
            {t("hallRent.miniapp.purchase.buyCrm")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
