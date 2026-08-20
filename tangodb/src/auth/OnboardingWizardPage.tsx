import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppSelect from "../components/ui/AppSelect";
import { useOrganization } from "../organization/OrganizationProvider";
import type { OrgModules, OrgPreset } from "../types/organization";
import { PRESET_MODULES } from "../types/organization";
import { CURRENCY_SELECT_OPTIONS, DEFAULT_CURRENCY_CODE } from "../lib/currencies";
import { ORG_MODULE_GROUPS, type OrgModuleGroupId } from "../lib/orgModules";
import { useCompleteOrganizationOnboarding } from "../hooks/useCompleteOrganizationOnboarding";
import { useGuestI18n } from "../hooks/useI18n";
import type { I18nKey } from "../lib/i18n/keys";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
} from "./AuthLayout";

type WizardStep = "name" | "preset" | "locale" | "modules";

const PRESET_I18N: Record<OrgPreset, { label: I18nKey; hint: I18nKey }> = {
  dance_school: {
    label: "onboarding.preset.danceSchool.label",
    hint: "onboarding.preset.danceSchool.hint",
  },
  solo_teacher: {
    label: "onboarding.preset.danceStudio.label",
    hint: "onboarding.preset.danceStudio.hint",
  },
  sport_section: {
    label: "onboarding.preset.school.label",
    hint: "onboarding.preset.school.hint",
  },
  gymnastics_club: {
    label: "onboarding.preset.club.label",
    hint: "onboarding.preset.club.hint",
  },
  custom: {
    label: "onboarding.preset.other.label",
    hint: "onboarding.preset.other.hint",
  },
};

const PRESET_VALUES: OrgPreset[] = [
  "dance_school",
  "solo_teacher",
  "sport_section",
  "gymnastics_club",
  "custom",
];

const MODULE_I18N: Record<keyof OrgModules, I18nKey> = {
  group_subscriptions: "onboarding.module.groupSubscriptions",
  personal_lessons: "onboarding.module.personalLessons",
  finance_basic: "onboarding.module.financeBasic",
  pair_subscriptions: "onboarding.module.pairSubscriptions",
  trio_lessons: "onboarding.module.trioLessons",
  multi_discipline: "onboarding.module.multiDiscipline",
  locations: "onboarding.module.locations",
};

const MODULE_GROUP_LABEL_KEYS: Record<OrgModuleGroupId, I18nKey> = {
  crm_sections: "orgModules.group.crmSections",
  lesson_formats: "orgModules.group.lessonFormats",
  infrastructure: "orgModules.group.infrastructure",
};

const LOCALE_VALUES = [
  { value: "ru-RU", key: "common.locale.ru" as const },
  { value: "en-US", key: "common.locale.en" as const },
];

export default function OnboardingWizardPage() {
  const { t } = useGuestI18n();
  const navigate = useNavigate();
  const { organizationId, refreshOrganization } = useOrganization();
  const completeOnboarding = useCompleteOrganizationOnboarding();
  const [step, setStep] = useState<WizardStep>("name");
  const [orgName, setOrgName] = useState("");
  const [preset, setPreset] = useState<OrgPreset>("dance_school");
  const [locale, setLocale] = useState("ru-RU");
  const [currencyCode, setCurrencyCode] = useState<string>(DEFAULT_CURRENCY_CODE);
  const [modules, setModules] = useState<OrgModules>(PRESET_MODULES.dance_school);
  const [error, setError] = useState<string | null>(null);
  const loading = completeOnboarding.isPending;

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
      setError(t("onboarding.error.noOrgSelected"));
      return;
    }

    setError(null);

    try {
      await completeOnboarding.mutateAsync({
        organizationId,
        name: orgName.trim(),
        orgPreset: preset,
        locale,
        currencyCode,
        modules,
      });
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
            : t("onboarding.error.saveFailed");
      setError(message === "onboarding_save_failed" ? t("onboarding.error.saveFailed") : message);
    }
  };

  const next = () => {
    if (step === "name") {
      if (!orgName.trim()) {
        setError(t("onboarding.error.nameRequired"));
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
    <AuthLayout
      title="TangoDB"
      subtitle={t("onboarding.subtitleStep", { step: stepIndex + 1, total: 4 })}
    >
      <AuthError message={error} />

      {step === "name" && (
        <AuthField
          label={t("onboarding.field.orgName")}
          value={orgName}
          onChange={setOrgName}
          placeholder="Studio Tango N"
          required
        />
      )}

      {step === "preset" && (
        <div className="space-y-2">
          {PRESET_VALUES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => applyPreset(value)}
              className={`w-full rounded-lg border px-4 py-3 text-left transition-colors cursor-pointer ${
                preset === value
                  ? "border-indigo-400 bg-indigo-50"
                  : "border-slate-200 hover:border-indigo-200"
              }`}
            >
              <p className="text-sm font-semibold text-slate-800">{t(PRESET_I18N[value].label)}</p>
              <p className="text-xs text-slate-500">{t(PRESET_I18N[value].hint)}</p>
            </button>
          ))}
        </div>
      )}

      {step === "locale" && (
        <div className="space-y-4">
          <AppSelect
            label={t("onboarding.field.locale")}
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
          >
            {LOCALE_VALUES.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.key)} ({option.value})
              </option>
            ))}
          </AppSelect>
          <AppSelect
            label={t("onboarding.field.currency")}
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value)}
          >
            {CURRENCY_SELECT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </AppSelect>
        </div>
      )}

      {step === "modules" && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">{t("orgModules.disableHint")}</p>
          {ORG_MODULE_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
                {t(MODULE_GROUP_LABEL_KEYS[group.id])}
              </p>
              {group.keys.map((key) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 cursor-pointer hover:bg-slate-50"
                >
                  <span className="text-sm text-slate-700">{t(MODULE_I18N[key])}</span>
                  <input
                    type="checkbox"
                    checked={modules[key]}
                    onChange={() => toggleModule(key)}
                    className="w-4 h-4 accent-indigo-600"
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {step !== "name" && (
          <AuthButton type="button" variant="secondary" onClick={back}>
            {t("common.back")}
          </AuthButton>
        )}
        <AuthButton loading={loading} onClick={next}>
          {step === "modules" ? t("onboarding.finish") : t("onboarding.next")}
        </AuthButton>
      </div>
    </AuthLayout>
  );
}
