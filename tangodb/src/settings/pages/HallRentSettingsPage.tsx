import { Navigate, useSearchParams } from "react-router-dom";
import { usePermissions } from "../../hooks/usePermissions";
import { useI18n } from "../../hooks/useI18n";
import { canManageVenueCostRules } from "../../lib/permissions";
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
  const { can, role } = usePermissions();
  const canManageVenue = canManageVenueCostRules(role);
  const canReadVenue = can("finance.read");

  return (
    <div className="panel-card-stack max-w-4xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t("hallRent.pageTitle")}</h2>
        <p className="text-xs text-slate-500 mt-1">{t("hallRent.pageSubtitle")}</p>
      </div>

      {!canReadVenue && (
        <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 px-4 py-6 text-center space-y-2">
          <p className="text-sm text-slate-600">{t("hallRent.emptyNoAccess")}</p>
          <p className="text-xs text-slate-500">{t("hallRent.emptyNoAccessHint")}</p>
        </div>
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
