import { useCallback, useState } from "react";
import AppSelect from "../components/ui/AppSelect";
import { getLocaleOptions, setGuestLocale } from "../lib/i18n";
import { useGuestI18n } from "../hooks/useI18n";
import type { LocaleCode } from "../lib/i18n/core";

export default function AuthLocalePicker() {
  const { locale, t } = useGuestI18n();
  const [value, setValue] = useState<LocaleCode>(locale as LocaleCode);

  const handleChange = useCallback(
    (next: string) => {
      setValue(next as LocaleCode);
      setGuestLocale(next);
    },
    []
  );

  const options = getLocaleOptions(t);

  return (
    <div className="flex justify-end">
      <div className="w-36">
        <AppSelect
          label={t("auth.locale.label")}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </AppSelect>
      </div>
    </div>
  );
}
