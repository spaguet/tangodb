import AppSelect, { fieldCls as inputCls } from "./AppSelect";
import { useI18n } from "../../hooks/useI18n";

export const PERSONAL_TARIFF_DURATION_PRESETS = [30, 45, 60, 90] as const;

export type PersonalTariffDurationSelect = "30" | "45" | "60" | "90" | "custom" | "";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

export function minutesToDurationSelect(minutes: number | null | undefined): PersonalTariffDurationSelect {
  if (minutes == null) return "";
  if ((PERSONAL_TARIFF_DURATION_PRESETS as readonly number[]).includes(minutes)) {
    return String(minutes) as PersonalTariffDurationSelect;
  }
  return "custom";
}

export function resolvePersonalTariffDurationMinutes(
  select: PersonalTariffDurationSelect,
  customValue: string
): number | null {
  if (select === "") return null;
  if (select === "custom") {
    const parsed = parseInt(customValue, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return parseInt(select, 10);
}

export function isValidPersonalTariffDuration(minutes: number | null, required: boolean): boolean {
  if (minutes == null) return !required;
  return minutes > 0;
}

interface PersonalTariffDurationFieldProps {
  select: PersonalTariffDurationSelect;
  onSelectChange: (value: PersonalTariffDurationSelect) => void;
  customValue: string;
  onCustomValueChange: (value: string) => void;
  /** Legacy tariff without duration — show recommendation, not hard requirement. */
  legacyOptional?: boolean;
}

export default function PersonalTariffDurationField({
  select,
  onSelectChange,
  customValue,
  onCustomValueChange,
  legacyOptional = false,
}: PersonalTariffDurationFieldProps) {
  const { t } = useI18n();

  return (
    <div className="field-stack">
      <label className={labelCls}>{t("prices.form.tariffDuration")}</label>
      <AppSelect
        value={select}
        onChange={(e) => onSelectChange(e.target.value as PersonalTariffDurationSelect)}
      >
        <option value="">{t("prices.form.tariffDurationUnset")}</option>
        {PERSONAL_TARIFF_DURATION_PRESETS.map((minutes) => (
          <option key={minutes} value={String(minutes)}>
            {t("prices.form.tariffDurationPreset", { minutes })}
          </option>
        ))}
        <option value="custom">{t("prices.form.tariffDurationCustom")}</option>
      </AppSelect>
      {select === "custom" && (
        <input
          type="number"
          min={1}
          step={1}
          value={customValue}
          onChange={(e) => onCustomValueChange(e.target.value)}
          placeholder={t("prices.form.tariffDurationCustomPlaceholder")}
          className={inputCls}
        />
      )}
      {legacyOptional && select === "" && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          {t("prices.form.tariffDurationLegacyHint")}
        </p>
      )}
    </div>
  );
}
