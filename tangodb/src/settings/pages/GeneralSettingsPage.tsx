import { useEffect, useState } from "react";
import AppSelect, { fieldCls as inputCls } from "../../components/ui/AppSelect";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useSettings } from "../SettingsProvider";

const LOCALE_OPTIONS = [
  { value: "ru-RU", label: "Русский (ru-RU)" },
  { value: "en-US", label: "English (en-US)" },
  { value: "vi-VN", label: "Tiếng Việt (vi-VN)" },
];

const CURRENCY_OPTIONS = [
  { value: "RUB", label: "RUB — ₽" },
  { value: "USD", label: "USD — $" },
  { value: "EUR", label: "EUR — €" },
  { value: "VND", label: "VND — ₫" },
];

const TIMEZONE_OPTIONS = [
  { value: "Europe/Moscow", label: "Europe/Moscow" },
  { value: "Asia/Ho_Chi_Minh", label: "Asia/Ho_Chi_Minh" },
  { value: "UTC", label: "UTC" },
];

const WEEK_START_OPTIONS = [
  { value: "1", label: "Понедельник" },
  { value: "7", label: "Воскресенье" },
];

export default function GeneralSettingsPage() {
  const toast = useToast();
  const { settings, isLoading, updateSettings, isUpdating, formatCurrency } = useSettings();

  const [locale, setLocale] = useState("ru-RU");
  const [currencyCode, setCurrencyCode] = useState("RUB");
  const [currencyDisplay, setCurrencyDisplay] = useState<"symbol" | "code">("symbol");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [weekStartsOn, setWeekStartsOn] = useState("1");
  const [brandingName, setBrandingName] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setLocale(settings.locale);
    setCurrencyCode(settings.currency_code);
    setCurrencyDisplay(settings.currency_display);
    setTimezone(settings.timezone);
    setWeekStartsOn(String(settings.week_starts_on));
    setBrandingName(settings.branding_name ?? "");
    setDirty(false);
  }, [settings]);

  if (isLoading || !settings) return <LoadingState label="Загрузка настроек..." />;

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    const res = await updateSettings({
      locale,
      currency_code: currencyCode,
      currency_display: currencyDisplay,
      timezone,
      week_starts_on: Number(weekStartsOn),
      branding_name: brandingName.trim() || null,
    });
    if (!res.success) {
      toast(res.error ?? "Не удалось сохранить", "error");
    } else {
      toast("Настройки сохранены", "success");
      setDirty(false);
    }
  };

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Общие настройки</h2>
        <p className="text-xs text-slate-500 mt-1">Язык, валюта и отображение в CRM.</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4 font-sans">
        <AppSelect label="Язык интерфейса" value={locale} onChange={(e) => { setLocale(e.target.value); markDirty(); }}>
          {LOCALE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <AppSelect label="Валюта" value={currencyCode} onChange={(e) => { setCurrencyCode(e.target.value); markDirty(); }}>
          {CURRENCY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <AppSelect
          label="Отображение валюты"
          value={currencyDisplay}
          onChange={(e) => { setCurrencyDisplay(e.target.value as "symbol" | "code"); markDirty(); }}
        >
          <option value="symbol">Символ (₽, $)</option>
          <option value="code">Код (RUB, USD)</option>
        </AppSelect>

        <AppSelect label="Часовой пояс" value={timezone} onChange={(e) => { setTimezone(e.target.value); markDirty(); }}>
          {TIMEZONE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <AppSelect label="Начало недели" value={weekStartsOn} onChange={(e) => { setWeekStartsOn(e.target.value); markDirty(); }}>
          {WEEK_START_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <div className="field-stack">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
            Название в шапке
          </label>
          <input
            type="text"
            value={brandingName}
            onChange={(e) => { setBrandingName(e.target.value); markDirty(); }}
            placeholder="TangoDB"
            className={inputCls}
          />
        </div>

        <p className="text-xs text-slate-500 bg-slate-50 rounded-lg px-3 py-2">
          Пример: {formatCurrency(1250000)}
        </p>

        <RequirePermission action="settings.manage" mode="hide">
          <button
            type="button"
            onClick={handleSave}
            disabled={!dirty || isUpdating}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold uppercase tracking-wider rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            {isUpdating ? "Сохранение..." : "Сохранить"}
          </button>
        </RequirePermission>
      </div>
    </div>
  );
}
