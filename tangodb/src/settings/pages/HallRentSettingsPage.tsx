import { Navigate, useSearchParams } from "react-router-dom";
import { usePermissions } from "../../hooks/usePermissions";
import { useI18n } from "../../hooks/useI18n";
import RentalTariffsSettingsPage from "./RentalTariffsSettingsPage";
import VenueCostsSettingsPage from "./VenueCostsSettingsPage";

/** Preserve ?new=1 when old /settings/venue-costs bookmarks are opened. */
export function VenueCostsLegacyRedirect() {
  const [params] = useSearchParams();
  const q = params.toString();
  return <Navigate to={`/settings/hall-rent${q ? `?${q}` : ""}`} replace />;
}

export default function HallRentSettingsPage() {
  const { t } = useI18n();
  const { can } = usePermissions();
  const canRental = can("schedule.write") && can("finance.read");
  const canVenue = can("finance.read");

  return (
    <div className="panel-card-stack max-w-4xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t("hallRent.pageTitle")}</h2>
        <p className="text-xs text-slate-500 mt-1">{t("hallRent.pageSubtitle")}</p>
      </div>

      {canRental && (
        <section className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t("hallRent.rentersTitle")}</h3>
            <p className="text-xs text-slate-500 mt-1">{t("hallRent.rentersSubtitle")}</p>
          </div>
          <RentalTariffsSettingsPage embedded />
        </section>
      )}

      {canVenue && (
        <section className="bg-white rounded-xl border border-amber-200/80 shadow-xs p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">{t("hallRent.studioTitle")}</h3>
            <p className="text-xs text-slate-500 mt-1">{t("hallRent.studioSubtitle")}</p>
          </div>
          <VenueCostsSettingsPage embedded />
        </section>
      )}
    </div>
  );
}
