import { Navigate, Route, Routes } from "react-router-dom";
import SettingsLayout from "../settings/SettingsLayout";
import SettingsIndexRedirect from "../settings/SettingsIndexRedirect";
import GeneralSettingsPage from "../settings/pages/GeneralSettingsPage";
import OrganizationSettingsPage from "../settings/pages/OrganizationSettingsPage";
import SubscriptionSettingsPage from "../settings/pages/SubscriptionSettingsPage";
import DisciplinesSettingsPage from "../settings/pages/DisciplinesSettingsPage";
import HallRentSettingsPage, { VenueCostsLegacyRedirect } from "../settings/pages/HallRentSettingsPage";
import LocationsSettingsPage from "../settings/pages/LocationsSettingsPage";
import DataExportPage from "../settings/pages/DataExportPage";
import LicenseSettingsPage from "../settings/pages/LicenseSettingsPage";
import IntegrationsSettingsPage from "../settings/pages/IntegrationsSettingsPage";

/** Settings workspace — same layout, sections, and guards as desktop (`SettingsLayout` / `PanelAccessRoute`). */
export default function SettingsPage() {
  return (
    <Routes>
      <Route element={<SettingsLayout />}>
        <Route index element={<SettingsIndexRedirect />} />
        <Route path="general" element={<GeneralSettingsPage />} />
        <Route path="organization" element={<OrganizationSettingsPage />} />
        <Route path="subscriptions" element={<SubscriptionSettingsPage />} />
        <Route path="disciplines" element={<DisciplinesSettingsPage />} />
        <Route path="locations" element={<LocationsSettingsPage />} />
        <Route path="hall-rent" element={<HallRentSettingsPage />} />
        <Route path="rental-tariffs" element={<Navigate to="/prices?section=hall-rent" replace />} />
        <Route path="venue-costs" element={<VenueCostsLegacyRedirect />} />
        <Route path="data" element={<DataExportPage />} />
        <Route path="integrations" element={<IntegrationsSettingsPage />} />
        <Route path="license" element={<LicenseSettingsPage />} />
      </Route>
    </Routes>
  );
}
