import { Navigate, useSearchParams } from "react-router-dom";
import { usePermissions } from "../../hooks/usePermissions";
import { useI18n } from "../../hooks/useI18n";
import {
  canManageVenueCostRules,
  canReadRentalTariffs,
  canWriteRentalTariffs,
} from "../../lib/permissions";
import RentalTariffsSettingsPage from "./RentalTariffsSettingsPage";
import VenueCostsSettingsPage from "./VenueCostsSettingsPage";
import RentalBillingProfileSection from "../../components/rental-billing/RentalBillingProfileSection";

/** Preserve ?new=1 when old /settings/venue-costs bookmarks are opened. */
export function VenueCostsLegacyRedirect() {
  const [params] = useSearchParams();
  const q = params.toString();
  return <Navigate to={`/settings/hall-rent${q ? `?${q}` : ""}`} replace />;
}

export default function HallRentSettingsPage() {
  const { t } = useI18n();
  const { can, role, options } = usePermissions();
  const canReadTariffs = canReadRentalTariffs(role, options);
  const canWriteTariffs = canWriteRentalTariffs(role, options);
  const canManageVenue = canManageVenueCostRules(role);
  const canReadVenue = can("finance.read");

  return (
    <div className="panel-card-stack max-w-4xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t("hallRent.pageTitle")}</h2>
        <p className="text-xs text-slate-500 mt-1">
          {canReadTariffs && !canReadVenue
            ? t("hallRent.pageSubtitleLookupOnly")
            : t("hallRent.pageSubtitle")}
        </p>
      </div>

      {canReadTariffs && (
        <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t("hallRent.rentersTitle")}</h3>
            <p className="text-xs text-slate-500 mt-1">
              {canWriteTariffs ? t("hallRent.rentersSubtitle") : t("hallRent.rentersSubtitleLookup")}
            </p>
          </div>
          <RentalTariffsSettingsPage embedded canWrite={canWriteTariffs} />
        </section>
      )}

      {canReadVenue && (
        <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t("hallRent.studioTitle")}</h3>
            <p className="text-xs text-slate-500 mt-1">{t("hallRent.studioSubtitle")}</p>
          </div>
          <VenueCostsSettingsPage embedded canManage={canManageVenue} />
        </section>
      )}

      {canReadVenue && (
        <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t("rentalBilling.sectionTitle")}</h3>
            <p className="text-xs text-slate-500 mt-1">{t("rentalBilling.sectionSubtitle")}</p>
          </div>
          <RentalBillingProfileSection embedded />
        </section>
      )}
    </div>
  );
}
