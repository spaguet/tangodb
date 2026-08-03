import { useMemo, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import AppSelect, { selectLabelCls } from "../ui/AppSelect";
import TeacherTariffDropdown, { type TeacherTariffOption } from "../ui/TeacherTariffDropdown";
import { btnAddSoftCls } from "../ui/buttonStyles";
import type { VenueCostPerLessonRules } from "../../lib/venueCostRules";
import {
  applyVenueCostLocationBulkCopy,
  applyVenueCostTeacherBulkApply,
  expandVenueCostTeacherTargets,
  planVenueCostLocationBulkCopy,
  planVenueCostTeacherBulkApply,
  type VenueCostRuleSection,
} from "../../lib/venueCostBulkCopy";

interface VenueCostBulkCopyPanelProps {
  rules: VenueCostPerLessonRules;
  teachers: TeacherTariffOption[];
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  onApply: (rules: VenueCostPerLessonRules) => void;
}

function ruleScopeLabel(
  section: VenueCostRuleSection,
  index: number,
  rules: VenueCostPerLessonRules,
  teachers: TeacherTariffOption[],
  disciplines: Array<{ id: string; name: string }>,
  locations: Array<{ id: string; name: string }>,
  t: ReturnType<typeof useI18n>["t"]
): string {
  const rule =
    section === "group" ? rules.group[index] : rules.personal[index];
  if (!rule) return `#${index + 1}`;
  const teacher = rule.teacherMemberId
    ? teachers.find((item) => item.id === rule.teacherMemberId)?.label ?? rule.teacherMemberId
    : t("venueCosts.selectTeacher");
  const discipline = rule.disciplineId
    ? disciplines.find((item) => item.id === rule.disciplineId)?.name ?? rule.disciplineId
    : t("venueCosts.allDisciplines");
  const location = rule.locationId
    ? locations.find((item) => item.id === rule.locationId)?.name ?? rule.locationId
    : t("venueCosts.allLocations");
  const sectionLabel =
    section === "group" ? t("venueCosts.groupRules") : t("venueCosts.personalRules");
  return `${sectionLabel} #${index + 1}: ${teacher} · ${discipline} · ${location}`;
}

export default function VenueCostBulkCopyPanel({
  rules,
  teachers,
  disciplines,
  locations,
  onApply,
}: VenueCostBulkCopyPanelProps) {
  const { t } = useI18n();
  const [teacherSection, setTeacherSection] = useState<VenueCostRuleSection>("group");
  const [sourceRuleIndex, setSourceRuleIndex] = useState(0);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [sourceLocationId, setSourceLocationId] = useState("");
  const [targetLocationIds, setTargetLocationIds] = useState<string[]>([]);
  const [teacherError, setTeacherError] = useState<string | null>(null);
  const [locationError, setLocationError] = useState<string | null>(null);

  const sectionRules =
    teacherSection === "group" ? rules.group : rules.personal;
  const teacherTargetIds = expandVenueCostTeacherTargets(
    teachers.map((item) => item.id),
    selectedTeacherIds
  );

  const teacherPlan = useMemo(() => {
    if (sectionRules.length === 0 || teacherTargetIds.length === 0) return null;
    const index = Math.min(sourceRuleIndex, sectionRules.length - 1);
    return planVenueCostTeacherBulkApply(rules, teacherSection, index, teacherTargetIds);
  }, [rules, teacherSection, sourceRuleIndex, sectionRules.length, teacherTargetIds]);

  const locationPlan = useMemo(() => {
    if (!sourceLocationId || targetLocationIds.length === 0) return null;
    return planVenueCostLocationBulkCopy(rules, sourceLocationId, targetLocationIds);
  }, [rules, sourceLocationId, targetLocationIds]);

  const handleTeacherApply = () => {
    if (!teacherPlan) {
      setTeacherError(t("venueCosts.bulk.error.noTargets"));
      return;
    }
    if (!teacherPlan.valid) {
      if (teacherPlan.conflicts.length > 0) {
        setTeacherError(t("venueCosts.bulk.error.conflict"));
      } else if (teacherPlan.createdRules === 0) {
        setTeacherError(t("venueCosts.bulk.error.nothingToCreate"));
      } else {
        setTeacherError(t("venueCosts.bulk.error.conflict"));
      }
      return;
    }
    const next = applyVenueCostTeacherBulkApply(rules, teacherPlan);
    if (!next) {
      setTeacherError(t("venueCosts.bulk.error.applyFailed"));
      return;
    }
    setTeacherError(null);
    onApply(next);
  };

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

  if (sectionRules.length === 0 && rules.group.length === 0 && rules.personal.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-slate-800">{t("venueCosts.bulk.title")}</h4>
        <p className="text-[11px] text-slate-500 mt-1">{t("venueCosts.bulk.hint")}</p>
      </div>

      <div className="space-y-3 rounded-lg border border-slate-100 bg-white p-3">
        <p className="text-xs font-medium text-slate-700">{t("venueCosts.bulk.teachersTitle")}</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <AppSelect
            label={t("venueCosts.bulk.section")}
            value={teacherSection}
            onChange={(e) => {
              setTeacherSection(e.target.value as VenueCostRuleSection);
              setSourceRuleIndex(0);
              setTeacherError(null);
            }}
          >
            <option value="group">{t("venueCosts.groupRules")}</option>
            <option value="personal">{t("venueCosts.personalRules")}</option>
          </AppSelect>
          <AppSelect
            label={t("venueCosts.bulk.sourceRule")}
            value={String(Math.min(sourceRuleIndex, Math.max(sectionRules.length - 1, 0)))}
            onChange={(e) => {
              setSourceRuleIndex(Number(e.target.value));
              setTeacherError(null);
            }}
            disabled={sectionRules.length === 0}
          >
            {sectionRules.length === 0 ? (
              <option value="0">{t("venueCosts.bulk.noRulesInSection")}</option>
            ) : (
              sectionRules.map((_, index) => (
                <option key={index} value={index}>
                  {ruleScopeLabel(teacherSection, index, rules, teachers, disciplines, locations, t)}
                </option>
              ))
            )}
          </AppSelect>
        </div>
        <TeacherTariffDropdown
          label={t("venueCosts.bulk.targetTeachers")}
          teachers={teachers}
          selectedTeacherIds={selectedTeacherIds}
          onChange={(ids) => {
            setSelectedTeacherIds(ids);
            setTeacherError(null);
          }}
          disabled={sectionRules.length === 0}
        />
        <p className="text-[11px] text-slate-500">{t("venueCosts.bulk.allTeachersHint")}</p>
        {teacherPlan && (
          <p className="text-xs text-slate-600">
            {t("venueCosts.bulk.preview", {
              created: teacherPlan.createdRules,
              skipped: teacherPlan.skippedDuplicates,
            })}
          </p>
        )}
        {teacherError && <p className="text-xs text-rose-600">{teacherError}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleTeacherApply}
            disabled={sectionRules.length === 0 || !teacherPlan?.valid}
            className={btnAddSoftCls}
          >
            {t("venueCosts.bulk.applyTeachers")}
          </button>
        </div>
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
