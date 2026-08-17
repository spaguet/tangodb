import AppSelect from "../ui/AppSelect";
import DatePickerField from "../ui/DatePickerField";
import { useI18n } from "../../hooks/useI18n";
import type { GroupRepeatConfig, GroupRepeatEndMode } from "../../lib/groupLessonRepeat";

const labelCls = "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";
const checkboxCls = "rounded border-ink-300 text-gold-700 focus:ring-gold-500";

interface GroupLessonRepeatFieldsProps {
  config: GroupRepeatConfig;
  onChange: (patch: Partial<GroupRepeatConfig>) => void;
  minEndDate: string;
}

export default function GroupLessonRepeatFields({
  config,
  onChange,
  minEndDate,
}: GroupLessonRepeatFieldsProps) {
  const { t, plural } = useI18n();

  const setEndMode = (endMode: GroupRepeatEndMode) => onChange({ endMode });

  return (
    <>
      <label className="flex items-start gap-2 text-sm text-ink-700 cursor-pointer">
        <input
          type="checkbox"
          checked={config.repeatWeekly}
          onChange={(e) => onChange({ repeatWeekly: e.target.checked })}
          className={`${checkboxCls} mt-0.5`}
        />
        <span className="text-xs leading-snug font-semibold">{t("common.repeatWeekly")}</span>
      </label>

      {config.repeatWeekly && (
        <div className="field-stack space-y-3">
          <div className="field-stack">
            <label className={labelCls}>{t("common.endDate")}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setEndMode("weeks")}
                className={`py-2 rounded-lg border font-sans text-[10px] font-semibold uppercase tracking-wider cursor-pointer ${
                  config.endMode === "weeks"
                    ? "bg-gold-700 text-white border-gold-700"
                    : "bg-ink-50 text-ink-600 border-ink-200"
                }`}
              >
                {t("common.nWeeks")}
              </button>
              <button
                type="button"
                onClick={() => setEndMode("date")}
                className={`py-2 rounded-lg border font-sans text-[10px] font-semibold uppercase tracking-wider cursor-pointer ${
                  config.endMode === "date"
                    ? "bg-gold-700 text-white border-gold-700"
                    : "bg-ink-50 text-ink-600 border-ink-200"
                }`}
              >
                {t("common.untilDate")}
              </button>
            </div>
          </div>

          {config.endMode === "weeks" ? (
            <AppSelect
              label={t("common.weekCount")}
              value={String(config.weekCount)}
              onChange={(e) => onChange({ weekCount: Number(e.target.value) || 2 })}
            >
              {[2, 3, 4, 6, 8, 12].map((n) => (
                <option key={n} value={n}>
                  {n}{" "}
                  {plural(n, [t("common.week.one"), t("common.week.few"), t("common.week.many")])}
                </option>
              ))}
            </AppSelect>
          ) : (
            <DatePickerField
              label={t("common.endDateLabel")}
              value={config.endDate}
              onChange={(endDate) => onChange({ endDate })}
              min={minEndDate}
            />
          )}
        </div>
      )}
    </>
  );
}
