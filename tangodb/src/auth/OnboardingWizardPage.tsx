import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppSelect from "../components/ui/AppSelect";
import { supabase } from "../lib/supabase";
import { useOrganization } from "../organization/OrganizationProvider";
import type { OrgModules, OrgPreset } from "../types/organization";
import { PRESET_MODULES } from "../types/organization";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
} from "./AuthLayout";

type WizardStep = "name" | "preset" | "locale" | "modules";

const PRESET_OPTIONS: { value: OrgPreset; label: string; hint: string }[] = [
  { value: "dance_school", label: "Танцевальная школа", hint: "Группы, пары, персональные" },
  { value: "solo_teacher", label: "Частный преподаватель", hint: "Персональные уроки" },
  { value: "sport_section", label: "Спортивная секция", hint: "Группы без pair cycle" },
  { value: "gymnastics_club", label: "Кружок / гимнастика", hint: "Группы и локации" },
  { value: "custom", label: "Своё", hint: "Настроить модули вручную" },
];

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

const MODULE_LABELS: { key: keyof OrgModules; label: string }[] = [
  { key: "group_subscriptions", label: "Групповые абонементы" },
  { key: "personal_lessons", label: "Персональные уроки" },
  { key: "finance_basic", label: "Финансы (отчёты и журнал)" },
  { key: "pair_subscriptions", label: "Парные абонементы" },
  { key: "trio_lessons", label: "Трио-уроки" },
  { key: "multi_discipline", label: "Несколько направлений" },
  { key: "locations", label: "Локации / залы" },
];

export default function OnboardingWizardPage() {
  const navigate = useNavigate();
  const { organizationId, refreshOrganization } = useOrganization();
  const [step, setStep] = useState<WizardStep>("name");
  const [orgName, setOrgName] = useState("");
  const [preset, setPreset] = useState<OrgPreset>("dance_school");
  const [locale, setLocale] = useState("ru-RU");
  const [currencyCode, setCurrencyCode] = useState("RUB");
  const [modules, setModules] = useState<OrgModules>(PRESET_MODULES.dance_school);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const stepIndex = useMemo(() => {
    const order: WizardStep[] = ["name", "preset", "locale", "modules"];
    return order.indexOf(step);
  }, [step]);

  const applyPreset = (next: OrgPreset) => {
    setPreset(next);
    if (next !== "custom") {
      setModules(PRESET_MODULES[next]);
    }
  };

  const toggleModule = (key: keyof OrgModules) => {
    setModules((prev) => ({ ...prev, [key]: !prev[key] }));
    setPreset("custom");
  };

  const finish = async () => {
    if (!organizationId) {
      setError("Организация не выбрана");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;

      const { data, error: rpcError } = await supabase.rpc("complete_organization_onboarding", {
        p_organization_id: organizationId,
        p_name: orgName.trim(),
        p_org_preset: preset,
        p_locale: locale,
        p_currency_code: currencyCode,
        p_modules: modules,
        p_pair_cycle_enabled: false,
      });

      if (rpcError) throw rpcError;
      if (!data || (data as { ok?: boolean }).ok !== true) {
        throw new Error("Не удалось сохранить настройки");
      }

      const { error: postRefreshError } = await supabase.auth.refreshSession();
      if (postRefreshError) throw postRefreshError;

      await refreshOrganization();
      navigate("/", { replace: true });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "object" &&
              err !== null &&
              "message" in err &&
              typeof (err as { message: unknown }).message === "string"
            ? (err as { message: string }).message
            : "Не удалось сохранить настройки";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const next = () => {
    if (step === "name") {
      if (!orgName.trim()) {
        setError("Укажите название организации");
        return;
      }
      setError(null);
      setStep("preset");
      return;
    }
    if (step === "preset") {
      setStep("locale");
      return;
    }
    if (step === "locale") {
      setStep("modules");
      return;
    }
    void finish();
  };

  const back = () => {
    setError(null);
    if (step === "preset") setStep("name");
    else if (step === "locale") setStep("preset");
    else if (step === "modules") setStep("locale");
  };

  return (
    <AuthLayout title="TangoDB" subtitle={`Настройка организации · шаг ${stepIndex + 1} из 4`}>
      <AuthError message={error} />

      {step === "name" && (
        <AuthField
          label="Название школы / студии"
          value={orgName}
          onChange={setOrgName}
          placeholder="Studio Tango N"
          required
        />
      )}

      {step === "preset" && (
        <div className="space-y-2">
          {PRESET_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => applyPreset(option.value)}
              className={`w-full rounded-lg border px-4 py-3 text-left transition-colors cursor-pointer ${
                preset === option.value
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-slate-200 hover:border-indigo-200"
              }`}
            >
              <p className="text-sm font-semibold text-slate-800">{option.label}</p>
              <p className="text-xs text-slate-500">{option.hint}</p>
            </button>
          ))}
        </div>
      )}

      {step === "locale" && (
        <div className="space-y-4">
          <AppSelect label="Язык интерфейса" value={locale} onChange={(e) => setLocale(e.target.value)}>
            {LOCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AppSelect>
          <AppSelect
            label="Валюта"
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
          >
            {CURRENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AppSelect>
        </div>
      )}

      {step === "modules" && (
        <div className="space-y-2">
          {MODULE_LABELS.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50"
            >
              <span className="text-sm text-slate-700">{label}</span>
              <input
                type="checkbox"
                checked={modules[key]}
                onChange={() => toggleModule(key)}
                className="w-4 h-4 accent-indigo-600"
              />
            </label>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {step !== "name" && (
          <AuthButton type="button" variant="secondary" onClick={back}>
            Назад
          </AuthButton>
        )}
        <AuthButton loading={loading} onClick={next}>
          {step === "modules" ? "Завершить" : "Далее"}
        </AuthButton>
      </div>
    </AuthLayout>
  );
}
