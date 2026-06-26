import AppSelect from "./AppSelect";
import { useI18n } from "../../hooks/useI18n";
import type { Discipline } from "../../types";

const checkboxCls = "rounded border-slate-300 text-indigo-600 focus:ring-indigo-500";

interface DisciplineTariffFieldProps {
  bindToDiscipline: boolean;
  onBindChange: (checked: boolean) => void;
  disciplineId: string;
  onDisciplineChange: (id: string) => void;
  disciplines: Discipline[];
}

export default function DisciplineTariffField({
  bindToDiscipline,
  onBindChange,
  disciplineId,
  onDisciplineChange,
  disciplines,
}: DisciplineTariffFieldProps) {
  const { t } = useI18n();
  return (
    <div className="space-y-2">
      <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
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
            <p className="text-xs text-slate-400 font-sans leading-relaxed">
              {t("ui.tariff.noDisciplinesHint")}
            </p>
          ) : (
            <AppSelect
              label={t("common.discipline")}
              value={disciplineId}
              onChange={(e) => onDisciplineChange(e.target.value)}
            >
              <option value="">{t("ui.tariff.selectDiscipline")}</option>
              {disciplines.map((disc) => (
                <option key={disc.id} value={disc.id}>
                  {disc.name}
                </option>
              ))}
            </AppSelect>
          )}
        </div>
      )}
    </div>
  );
}
