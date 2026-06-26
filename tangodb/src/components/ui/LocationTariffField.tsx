import AppSelect from "./AppSelect";
import { useI18n } from "../../hooks/useI18n";
import type { Location } from "../../hooks/useLocations";

const checkboxCls = "rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";

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
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
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
            <p className="text-xs text-slate-400 font-sans leading-relaxed">
              {t("ui.tariff.noLocationsHint")}
            </p>
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
