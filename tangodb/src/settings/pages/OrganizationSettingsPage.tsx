import { useEffect, useState } from "react";
import AppSelect from "../../components/ui/AppSelect";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useOrganization } from "../../organization/OrganizationProvider";
import type { OrgModules, OrgPreset } from "../../types/organization";
import { PRESET_MODULES } from "../../types/organization";
import { useSettings } from "../SettingsProvider";

const PRESET_OPTIONS: { value: OrgPreset; label: string }[] = [
  { value: "dance_school", label: "Танцевальная школа" },
  { value: "solo_teacher", label: "Частный преподаватель" },
  { value: "sport_section", label: "Спортивная секция" },
  { value: "gymnastics_club", label: "Кружок / гимнастика" },
  { value: "custom", label: "Своё" },
];

const MODULE_LABELS: { key: keyof OrgModules; label: string }[] = [
  { key: "group_subscriptions", label: "Групповые абонементы" },
  { key: "personal_lessons", label: "Персональные уроки" },
  { key: "pair_subscriptions", label: "Парные абонементы" },
  { key: "trio_lessons", label: "Трио-уроки" },
  { key: "multi_discipline", label: "Несколько направлений" },
  { key: "locations", label: "Локации / залы" },
];

export default function OrganizationSettingsPage() {
  const toast = useToast();
  const { organization } = useOrganization();
  const { settings, isLoading, updateSettings, isUpdating } = useSettings();

  const [orgPreset, setOrgPreset] = useState<OrgPreset>("dance_school");
  const [modules, setModules] = useState<OrgModules>(PRESET_MODULES.dance_school);
  const [teachersCanManageDisciplines, setTeachersCanManageDisciplines] = useState(false);
  const [pairCycleEnabled, setPairCycleEnabled] = useState(true);
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState(2);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setOrgPreset(settings.org_preset);
    setModules(settings.modules);
    setTeachersCanManageDisciplines(settings.teachers_can_manage_disciplines);
    setPairCycleEnabled(settings.pair_cycle_enabled);
    setLowBalanceThreshold(settings.low_balance_threshold);
    setDirty(false);
  }, [settings]);

  if (isLoading || !settings) return <LoadingState label="Загрузка настроек..." />;

  const applyPreset = (preset: OrgPreset) => {
    setOrgPreset(preset);
    if (preset !== "custom") setModules(PRESET_MODULES[preset]);
    setDirty(true);
  };

  const toggleModule = (key: keyof OrgModules) => {
    setModules((prev) => ({ ...prev, [key]: !prev[key] }));
    setOrgPreset("custom");
    setDirty(true);
  };

  const handleSave = async () => {
    const res = await updateSettings({
      org_preset: orgPreset,
      modules,
      teachers_can_manage_disciplines: teachersCanManageDisciplines,
      pair_cycle_enabled: pairCycleEnabled,
      low_balance_threshold: lowBalanceThreshold,
    });
    if (!res.success) {
      toast(res.error ?? "Не удалось сохранить", "error");
    } else {
      toast("Настройки организации сохранены", "success");
      setDirty(false);
    }
  };

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Организация</h2>
        <p className="text-xs text-slate-500 mt-1">
          {organization?.name ?? "—"} · пресет и модули CRM.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4 font-sans">
        <AppSelect label="Пресет организации" value={orgPreset} onChange={(e) => applyPreset(e.target.value as OrgPreset)}>
          {PRESET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </AppSelect>

        <div className="space-y-2">
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">Модули</p>
          {MODULE_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={modules[key]}
                onChange={() => toggleModule(key)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              {label}
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={teachersCanManageDisciplines}
            onChange={(e) => { setTeachersCanManageDisciplines(e.target.checked); setDirty(true); }}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Преподаватели могут редактировать направления
        </label>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={pairCycleEnabled}
            onChange={(e) => { setPairCycleEnabled(e.target.checked); setDirty(true); }}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          Цикл парных абонементов (m1/m2/m3)
        </label>

        <div className="field-stack">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
            Порог «мало занятий»
          </label>
          <input
            type="number"
            min={0}
            value={lowBalanceThreshold}
            onChange={(e) => { setLowBalanceThreshold(Number(e.target.value)); setDirty(true); }}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
        </div>

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
