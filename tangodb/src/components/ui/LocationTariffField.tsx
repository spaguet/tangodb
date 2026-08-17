import AppSelect from "./AppSelect";
import AddLocationsInSettingsHint from "./AddLocationsInSettingsHint";
import { useEffect } from "react";
import { useI18n } from "../../hooks/useI18n";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules, shouldShowLocationPicker } from "../../lib/orgModules";
import type { Location } from "../../hooks/useLocations";

const checkboxCls = "rounded border-ink-300 text-gold-700 focus:ring-gold-500";

interface LocationTariffFieldProps {
  bindToLocation: boolean;
  onBindChange: (checked: boolean) => void;
  locationId: string;
  onLocationChange: (id: string) => void;
  locations: Location[];
}

export default function LocationTariffField({
  bindToLocation,
  onBindChange,
  locationId,
  onLocationChange,
  locations,
}: LocationTariffFieldProps) {
  const { t } = useI18n();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);
  const show = shouldShowLocationPicker(modules, locations.length);

  useEffect(() => {
    if (!show && locations.length > 0) {
      onBindChange(true);
      if (locationId !== locations[0].id) {
        onLocationChange(locations[0].id);
      }
    }
  }, [show, locations, locationId, onBindChange, onLocationChange]);

  if (!show) return null;

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-ink-700 cursor-pointer">
        <input
          type="checkbox"
          checked={bindToLocation}
          onChange={(e) => onBindChange(e.target.checked)}
          className={`${checkboxCls} mt-0.5`}
        />
        <span className="text-xs leading-snug">
          {t("ui.tariff.bindLocation")}
        </span>
      </label>

      {bindToLocation && (
        <div className="animate-fade-in">
          {locations.length === 0 ? (
            <AddLocationsInSettingsHint className="text-xs text-ink-500 font-sans leading-relaxed" />
          ) : (
            <AppSelect
              label={t("subscriptions.filter.location")}
              value={locationId}
              onChange={(e) => onLocationChange(e.target.value)}
            >
              <option value="">{t("ui.tariff.selectLocation")}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </AppSelect>
          )}
        </div>
      )}
    </div>
  );
}
