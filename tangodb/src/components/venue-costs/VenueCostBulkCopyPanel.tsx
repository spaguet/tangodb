import { useMemo, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import AppSelect, { selectLabelCls } from "../ui/AppSelect";
import { btnAddSoftCls } from "../ui/buttonStyles";
import type { VenueCostPerLessonRules } from "../../lib/venueCostRules";
import {
  applyVenueCostLocationBulkCopy,
  planVenueCostLocationBulkCopy,
} from "../../lib/venueCostBulkCopy";

interface VenueCostBulkCopyPanelProps {
  rules: VenueCostPerLessonRules;
  locations: Array<{ id: string; name: string }>;
  onApply: (rules: VenueCostPerLessonRules) => void;
}

export default function VenueCostBulkCopyPanel({
  rules,
  locations,
  onApply,
}: VenueCostBulkCopyPanelProps) {
  const { t } = useI18n();
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [targetLocationIds, setTargetLocationIds] = useState<string[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);

  const locationPlan = useMemo(() => {
    if (!sourceLocationId || targetLocationIds.length === 0) return null;
    return planVenueCostLocationBulkCopy(rules, sourceLocationId, targetLocationIds);
  }, [rules, sourceLocationId, targetLocationIds]);

  const handleLocationApply = () => {
    if (!locationPlan) {
      setLocationError(t("venueCosts.bulk.error.noTargets"));
      return;
    }
    if (!locationPlan.valid) {
      if (locationPlan.conflicts.length > 0) {
        setLocationError(t("venueCosts.bulk.error.conflict"));
      } else if (locationPlan.createdRules === 0) {
        setLocationError(t("venueCosts.bulk.error.nothingToCreate"));
      } else {
        setLocationError(t("venueCosts.bulk.error.conflict"));
      }
      return;
    }
    const next = applyVenueCostLocationBulkCopy(rules, locationPlan);
    if (!next) {
      setLocationError(t("venueCosts.bulk.error.applyFailed"));
      return;
    }
    setLocationError(null);
    onApply(next);
  };

  const toggleTargetLocation = (locationId: string) => {
    setTargetLocationIds((current) =>
      current.includes(locationId) ? current.filter((id) => id !== locationId) : [...current, locationId]
    );
  };

  if (rules.group.length === 0 && rules.personal.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-800">{t("venueCosts.bulk.title")}</h4>
        <p className="text-[11px] text-slate-500 mt-1">{t("venueCosts.bulk.hint")}</p>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-100 bg-white p-3">
        <p className="text-xs font-medium text-slate-700">{t("venueCosts.bulk.locationsTitle")}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <AppSelect
            label={t("venueCosts.bulk.sourceLocation")}
            value={sourceLocationId}
            onChange={(e) => {
              setSourceLocationId(e.target.value);
              setLocationError(null);
            }}
          >
            <option value="">{t("venueCosts.bulk.selectLocation")}</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.name}
              </option>
            ))}
          </AppSelect>
          <div className="field-stack">
            <span className={selectLabelCls}>{t("venueCosts.bulk.targetLocations")}</span>
            <div className="rounded-lg border border-slate-200 p-2 space-y-1 max-h-32 overflow-y-auto">
              {locations.length === 0 ? (
                <p className="text-xs text-slate-500">{t("venueCosts.fixedPeriod.noLocations")}</p>
              ) : (
                locations
                  .filter((loc) => loc.id !== sourceLocationId)
                  .map((loc) => (
                    <label key={loc.id} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={targetLocationIds.includes(loc.id)}
                        onChange={() => toggleTargetLocation(loc.id)}
                        className="rounded border-slate-300 text-indigo-600"
                      />
                      {loc.name}
                    </label>
                  ))
              )}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-slate-500">{t("venueCosts.bulk.locationsHint")}</p>
        {locationPlan && (
          <p className="text-xs text-slate-600">
            {t("venueCosts.bulk.preview", {
              created: locationPlan.createdRules,
              skipped: locationPlan.skippedDuplicates,
            })}
          </p>
        )}
        {locationError && <p className="text-xs text-rose-600">{locationError}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleLocationApply}
            disabled={!locationPlan?.valid}
            className={btnAddSoftCls}
          >
            {t("venueCosts.bulk.applyLocations")}
          </button>
        </div>
      </div>
    </section>
  );
}
