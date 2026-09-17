import { useEffect, useMemo, useState } from "react";
import AppSelect, { fieldCls as inputCls } from "../../components/ui/AppSelect";
import { btnAddCls } from "../../components/ui/buttonStyles";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { CURRENCY_SELECT_OPTIONS, DEFAULT_CURRENCY_CODE, getCurrencySymbolHint } from "../../lib/currencies";
import { getLocaleOptions, getWeekStartOptions, setGuestLocale } from "../../lib/i18n";
import { resolveMutationError } from "../../lib/resolveMutationError";
import { useI18n } from "../../hooks/useI18n";
import { useSettings } from "../SettingsProvider";
import { TIMEZONE_OPTIONS } from "../../lib/timezoneOptions";

export default function GeneralSettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings, isLoading, updateSettings, isUpdating, formatCurrency } = useSettings();

  const localeOptions = useMemo(() => getLocaleOptions(t), [t]);
  const weekStartOptions = useMemo(() => getWeekStartOptions(t), [t]);

  const [locale, setLocale] = useState("ru-RU");
  const [currencyCode, setCurrencyCode] = useState<string>(DEFAULT_CURRENCY_CODE);
  const [currencyDisplay, setCurrencyDisplay] = useState<"symbol" | "code">("symbol");
  const [timezone, setTimezone] = useState("Europe/Moscow");
  const [weekStartsOn, setWeekStartsOn] = useState("1");
  const [brandingName, setBrandingName] = useState("");
  const [showBeginnerHints, setShowBeginnerHints] = useState(true);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setLocale(settings.locale);
    setCurrencyCode(settings.currency_code);
    setCurrencyDisplay(settings.currency_display);
    setTimezone(settings.timezone);
    setWeekStartsOn(String(settings.week_starts_on));
    setBrandingName(settings.branding_name ?? "");
    setShowBeginnerHints(settings.show_beginner_hints !== false);
    setDirty(false);
  }, [settings]);

  if (isLoading || !settings) return <LoadingState label={t("settings.general.loading")} />;

  const currencySymbolHint = getCurrencySymbolHint(currencyCode);

  const markDirty = () => setDirty(true);

  const handleSave = async () => {
    const res = await updateSettings({
      locale,
      currency_code: currencyCode,
      currency_display: currencyDisplay,
      timezone,
      week_starts_on: Number(weekStartsOn),
      branding_name: brandingName.trim() || null,
      show_beginner_hints: showBeginnerHints,
    });
    if (!res.success) {
      toast(resolveMutationError(res.error, "settings.saveError", t), "error");
    } else {
      setGuestLocale(locale);
      toast(t("settings.saveSuccess"), "success");
      setDirty(false);
    }
  };

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t("settings.general.title")}</h2>
        <p className="text-xs text-slate-500 mt-1">{t("settings.general.subtitle")}</p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4 font-sans">
        <AppSelect
          label={t("settings.general.field.locale")}
          value={locale}
          onChange={(e) => { setLocale(e.target.value); markDirty(); }}
        >
          {localeOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <AppSelect
          label={t("settings.general.field.currency")}
          value={currencyCode}
          onChange={(e) => { setCurrencyCode(e.target.value); markDirty(); }}
        >
          {CURRENCY_SELECT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <AppSelect
          label={t("settings.general.field.currencyDisplay")}
          value={currencyDisplay}
          onChange={(e) => { setCurrencyDisplay(e.target.value as "symbol" | "code"); markDirty(); }}
        >
          <option value="symbol">
            {t("settings.general.currencyDisplay.symbolFor", { symbol: currencySymbolHint })}
          </option>
          <option value="code">
            {t("settings.general.currencyDisplay.codeFor", { code: currencyCode })}
          </option>
        </AppSelect>

        <AppSelect
          label={t("settings.general.field.timezone")}
          value={timezone}
          onChange={(e) => { setTimezone(e.target.value); markDirty(); }}
        >
          {TIMEZONE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <AppSelect
          label={t("settings.general.field.weekStart")}
          value={weekStartsOn}
          onChange={(e) => { setWeekStartsOn(e.target.value); markDirty(); }}
        >
          {weekStartOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <div className="field-stack">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
            {t("settings.general.brandingName")}
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
          {t("settings.general.currencyPreview", { value: formatCurrency(1250000) })}
        </p>

        <label className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={showBeginnerHints}
            onChange={(e) => {
              setShowBeginnerHints(e.target.checked);
              markDirty();
            }}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">
              {t("settings.general.beginnerHints")}
            </span>
            <span className="block text-xs text-slate-500 mt-0.5 leading-relaxed">
              {t("settings.general.beginnerHintsHint")}
            </span>
          </span>
        </label>

        <RequirePermission action="settings.manage" mode="hide">
          <div className="sticky bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] z-30 -mx-4 px-4 py-2 bg-white/95 backdrop-blur-sm border-t border-slate-100 md:static md:mx-0 md:px-0 md:py-0 md:bg-transparent md:backdrop-blur-none md:border-t-0">
            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || isUpdating}
              className={`w-full ${btnAddCls}`}
            >
              {isUpdating ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </RequirePermission>
      </div>
    </div>
  );
}
