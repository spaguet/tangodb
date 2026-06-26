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
  { key: "finance_basic", label: "Финансы (отчёты и журнал)" },
  { key: "pair_subscriptions", label: "Парные абонементы" },
  { key: "trio_lessons", label: "Трио-уроки" },
  { key: "multi_discipline", label: "Несколько направлений" },
  { key: "locations", label: "Локации / залы" },
];

const ROLE_OVERRIDE_LABELS: {
  key:
    | "teachers_can_sell_subscriptions"
    | "teachers_can_edit_clients"
    | "teachers_can_export"
    | "teachers_can_view_full_schedule"
    | "admin_can_export"
    | "admin_can_manage_team";
  label: string;
  hint?: string;
}[] = [
  {
    key: "teachers_can_sell_subscriptions",
    label: "Преподаватели могут продавать групповые абонементы",
  },
  {
    key: "teachers_can_edit_clients",
    label: "Преподаватели могут редактировать карточки учеников",
  },
  {
    key: "teachers_can_export",
    label: "Преподаватели могут экспортировать данные (в своём scope)",
  },
  {
    key: "teachers_can_view_full_schedule",
    label: "Преподаватели видят всё расписание (read-only, без контактов учеников)",
    hint: "По умолчанию включено",
  },
  {
    key: "admin_can_export",
    label: "Администратор может экспортировать CSV",
  },
  {
    key: "admin_can_manage_team",
    label: "Администратор может управлять командой",
    hint: "Не рекомендуется",
  },
];

export default function OrganizationSettingsPage() {
  const toast = useToast();
  const { organization } = useOrganization();
  const { settings, isLoading, updateSettings, isUpdating } = useSettings();

  const [orgPreset, setOrgPreset] = useState<OrgPreset>("dance_school");
  const [modules, setModules] = useState<OrgModules>(PRESET_MODULES.dance_school);
  const [teachersCanManageDisciplines, setTeachersCanManageDisciplines] = useState(false);
  const [teachersCanSellSubscriptions, setTeachersCanSellSubscriptions] = useState(false);
  const [teachersCanEditClients, setTeachersCanEditClients] = useState(false);
  const [teachersCanExport, setTeachersCanExport] = useState(false);
  const [teachersCanViewFullSchedule, setTeachersCanViewFullSchedule] = useState(true);
  const [adminCanExport, setAdminCanExport] = useState(false);
  const [adminCanManageTeam, setAdminCanManageTeam] = useState(false);
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState(2);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setOrgPreset(settings.org_preset);
    setModules(settings.modules);
    setTeachersCanManageDisciplines(settings.teachers_can_manage_disciplines);
    setTeachersCanSellSubscriptions(settings.teachers_can_sell_subscriptions);
    setTeachersCanEditClients(settings.teachers_can_edit_clients);
    setTeachersCanExport(settings.teachers_can_export);
    setTeachersCanViewFullSchedule(settings.teachers_can_view_full_schedule);
    setAdminCanExport(settings.admin_can_export);
    setAdminCanManageTeam(settings.admin_can_manage_team);
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
    setModules((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      return next;
    });
    setOrgPreset("custom");
    setDirty(true);
  };

  const handleSave = async () => {
    const res = await updateSettings({
      org_preset: orgPreset,
      modules,
      teachers_can_manage_disciplines: teachersCanManageDisciplines,
      teachers_can_sell_subscriptions: teachersCanSellSubscriptions,
      teachers_can_edit_clients: teachersCanEditClients,
      teachers_can_export: teachersCanExport,
      teachers_can_view_full_schedule: teachersCanViewFullSchedule,
      admin_can_export: adminCanExport,
      admin_can_manage_team: adminCanManageTeam,
      pair_cycle_enabled: false,
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

        <RequirePermission action="settings.manage" mode="hide">
          <div className="border-t border-slate-100 pt-4 space-y-2">
            <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
              Расширенные права ролей
            </p>
            {ROLE_OVERRIDE_LABELS.map(({ key, label, hint }) => {
              const checkedMap = {
                teachers_can_sell_subscriptions: teachersCanSellSubscriptions,
                teachers_can_edit_clients: teachersCanEditClients,
                teachers_can_export: teachersCanExport,
                teachers_can_view_full_schedule: teachersCanViewFullSchedule,
                admin_can_export: adminCanExport,
                admin_can_manage_team: adminCanManageTeam,
              } as const;
              const setters = {
                teachers_can_sell_subscriptions: setTeachersCanSellSubscriptions,
                teachers_can_edit_clients: setTeachersCanEditClients,
                teachers_can_export: setTeachersCanExport,
                teachers_can_view_full_schedule: setTeachersCanViewFullSchedule,
                admin_can_export: setAdminCanExport,
                admin_can_manage_team: setAdminCanManageTeam,
              } as const;

              return (
                <label key={key} className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checkedMap[key]}
                    onChange={(e) => { setters[key](e.target.checked); setDirty(true); }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mt-0.5"
                  />
                  <span>
                    {label}
                    {hint ? (
                      <span className="block text-xs text-slate-400 mt-0.5">{hint}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </RequirePermission>

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
