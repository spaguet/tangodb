import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../../hooks/useI18n";
import {
  computeGroupPreviewPair,
  defaultGroupPreviewScope,
  type VenueCostPerLessonRules,
  type VenueCostPreviewScope,
} from "../../lib/venueCostRules";
import { formatCurrency } from "../../lib/utils";
import AppSelect from "../ui/AppSelect";

interface VenueCostGroupPreviewProps {
  rules: VenueCostPerLessonRules;
  teachers: Array<{ id: string; label: string }>;
  disciplines: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string }>;
  compact?: boolean;
}

export default function VenueCostGroupPreview({
  rules,
  teachers,
  disciplines,
  locations,
  compact = false,
}: VenueCostGroupPreviewProps) {
  const { t } = useI18n();
  const defaultScope = useMemo(() => defaultGroupPreviewScope(rules), [rules]);
  const [scope, setScope] = useState<VenueCostPreviewScope>(defaultScope);

  useEffect(() => {
    setScope((current) => {
      if (current.teacherMemberId) return current;
      return defaultScope;
    });
  }, [defaultScope]);

  if (!rules.group.length) return null;

  const preview = computeGroupPreviewPair(rules, scope);
  const wrapperCls = compact
    ? "mt-1 space-y-1.5"
    : "rounded-lg bg-slate-50 border border-slate-100 p-3 space-y-2";

  return (
    <div className={wrapperCls}>
      <p className={compact ? "text-[11px] text-slate-400" : "text-[11px] text-slate-500"}>
        {t("venueCosts.preview.scopeHint")}
      </p>
      <div className={compact ? "grid gap-1.5 sm:grid-cols-3" : "grid gap-2 sm:grid-cols-3"}>
        <AppSelect
          label={t("venueCosts.teacher")}
          value={scope.teacherMemberId ?? ""}
          onChange={(e) =>
            setScope((current) => ({
              ...current,
              teacherMemberId: e.target.value || null,
            }))
          }
        >
          <option value="">{t("venueCosts.selectTeacher")}</option>
          {teachers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </AppSelect>
        <AppSelect
          label={t("venueCosts.discipline")}
          value={scope.disciplineId ?? ""}
          onChange={(e) =>
            setScope((current) => ({
              ...current,
              disciplineId: e.target.value || null,
            }))
          }
        >
          <option value="">{t("venueCosts.allDisciplines")}</option>
          {disciplines.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </AppSelect>
        <AppSelect
          label={t("venueCosts.location")}
          value={scope.locationId ?? ""}
          onChange={(e) =>
            setScope((current) => ({
              ...current,
              locationId: e.target.value || null,
            }))
          }
        >
          <option value="">{t("venueCosts.allLocations")}</option>
          {locations.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </AppSelect>
      </div>
      {preview ? (
        <p className={compact ? "text-[11px] text-slate-400" : "text-xs text-slate-600"}>
          {t("venueCosts.preview", {
            four: formatCurrency(preview.four),
            five: formatCurrency(preview.five),
          })}
        </p>
      ) : (
        <p className={compact ? "text-[11px] text-slate-400 italic" : "text-xs text-slate-500 italic"}>
          {t("venueCosts.preview.selectTeacher")}
        </p>
      )}
    </div>
  );
}
