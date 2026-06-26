import { useEffect } from "react";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules, shouldShowLocationPicker } from "../../lib/orgModules";
import { useI18n } from "../../hooks/useI18n";
import AppSelect from "./AppSelect";

interface LocationOption {
  id: string;
  name: string;
}

interface LocationSelectProps {
  locations: LocationOption[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
  required?: boolean;
  /** Include empty "all locations" option (for filters). */
  allowAll?: boolean;
  allOptionLabel?: string;
}

export default function LocationSelect({
  locations,
  value,
  onChange,
  label,
  required = false,
  allowAll = false,
  allOptionLabel,
}: LocationSelectProps) {
  const { t } = useI18n();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);
  const show = shouldShowLocationPicker(modules, locations.length);
  const resolvedLabel = label ?? t("schedule.form.location");

  useEffect(() => {
    if (locations.length === 0) return;
    const defaultId = locations[0].id;
    if (allowAll) return;
    if (!value || (!show && value !== defaultId)) {
      onChange(defaultId);
    }
  }, [show, locations, value, onChange, allowAll]);

  if (!show) return null;

  return (
    <AppSelect
      label={resolvedLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
    >
      {allowAll && (
        <option value="">{allOptionLabel ?? t("common.allLocations")}</option>
      )}
      {locations.length === 0 ? (
        <option value="">{t("common.noLocationsAvailable")}</option>
      ) : (
        locations.map((loc) => (
          <option key={loc.id} value={loc.id}>
            {loc.name}
          </option>
        ))
      )}
    </AppSelect>
  );
}
