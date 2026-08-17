import { useMemo } from "react";
import GroupCheckboxDropdown from "./GroupCheckboxDropdown";
import { useI18n } from "../../hooks/useI18n";
import type { Discipline } from "../../types";

const checkboxCls = "rounded border-ink-300 text-gold-700 focus:ring-gold-500";

interface DisciplineTariffFieldProps {
  bindToDiscipline: boolean;
  onBindChange: (checked: boolean) => void;
  disciplineIds: string[];
  onDisciplineIdsChange: (ids: string[]) => void;
  disciplines: Discipline[];
}

export default function DisciplineTariffField({
  bindToDiscipline,
  onBindChange,
  disciplineIds,
  onDisciplineIdsChange,
  disciplines,
}: DisciplineTariffFieldProps) {
  const { t } = useI18n();
  const disciplineOptions = useMemo(
    () => disciplines.map((disc) => ({ key: disc.id, label: disc.name })),
    [disciplines]
  );

  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-ink-700 cursor-pointer">
        <input
          type="checkbox"
          checked={bindToDiscipline}
          onChange={(e) => onBindChange(e.target.checked)}
          className={`${checkboxCls} mt-0.5`}
        />
        <span className="text-xs leading-snug">{t("ui.tariff.bindDiscipline")}</span>
      </label>

      {bindToDiscipline && (
        <div className="animate-fade-in">
          {disciplines.length === 0 ? (
            <p className="text-xs text-ink-500 font-sans leading-relaxed">
              {t("ui.tariff.noDisciplinesHint")}
            </p>
          ) : (
            <GroupCheckboxDropdown
              label={t("common.discipline")}
              options={disciplineOptions}
              selectedKeys={disciplineIds}
              onChange={onDisciplineIdsChange}
              placeholder={t("ui.tariff.selectDiscipline")}
              emptyMessage={t("ui.tariff.noDisciplinesHint")}
            />
          )}
        </div>
      )}
    </div>
  );
}
