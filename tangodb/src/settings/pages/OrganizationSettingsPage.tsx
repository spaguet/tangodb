import { useEffect, useMemo, useState } from "react";
import AppSelect from "../../components/ui/AppSelect";
import LoadingState from "../../components/ui/LoadingState";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useOrganization } from "../../organization/OrganizationProvider";
import type { OrgModules, OrgPreset } from "../../types/organization";
import { PRESET_MODULES } from "../../types/organization";
import { useSettings } from "../SettingsProvider";
import { useI18n } from "../../hooks/useI18n";
import type { I18nKey } from "../../lib/i18n/keys";

const PRESET_KEYS: Record<OrgPreset, I18nKey> = {
  dance_school: "settings.org.preset.danceSchool",
  solo_teacher: "settings.org.preset.soloTeacher",
  sport_section: "settings.org.preset.sportSection",
  gymnastics_club: "settings.org.preset.gymnasticsClub",
  custom: "settings.org.preset.custom",
};

const MODULE_KEYS: { key: keyof OrgModules; labelKey: I18nKey }[] = [
  { key: "group_subscriptions", labelKey: "settings.org.module.groupSubscriptions" },
  { key: "personal_lessons", labelKey: "settings.org.module.personalLessons" },
  { key: "finance_basic", labelKey: "settings.org.module.financeBasic" },
  { key: "pair_subscriptions", labelKey: "settings.org.module.pairSubscriptions" },
  { key: "trio_lessons", labelKey: "settings.org.module.trioLessons" },
  { key: "multi_discipline", labelKey: "settings.org.module.multiDiscipline" },
  { key: "locations", labelKey: "settings.org.module.locations" },
];

const ROLE_OVERRIDE_KEYS: {
  key:
    | "teachers_can_sell_subscriptions"
    | "teachers_can_edit_clients"
    | "teachers_can_export"
    | "teachers_can_view_full_schedule"
    | "admin_can_export"
    | "admin_can_manage_team";
  labelKey: I18nKey;
  hintKey?: I18nKey;
}[] = [
  { key: "teachers_can_sell_subscriptions", labelKey: "settings.org.role.teachersSellSubs" },
  { key: "teachers_can_edit_clients", labelKey: "settings.org.role.teachersEditClients" },
  { key: "teachers_can_export", labelKey: "settings.org.role.teachersExport" },
  {
    key: "teachers_can_view_full_schedule",
    labelKey: "settings.org.role.teachersViewSchedule",
    hintKey: "common.defaultOn",
  },
  { key: "admin_can_export", labelKey: "settings.org.role.adminExport" },
  {
    key: "admin_can_manage_team",
    labelKey: "settings.org.role.adminManageTeam",
    hintKey: "common.notRecommended",
  },
];

export default function OrganizationSettingsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const { organization } = useOrganization();
  const { settings, isLoading, updateSettings, isUpdating } = useSettings();

  const presetOptions = useMemo(
    () =>
      (Object.keys(PRESET_KEYS) as OrgPreset[]).map((value) => ({
        value,
        label: t(PRESET_KEYS[value]),
      })),
    [t]
  );

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

  if (isLoading || !settings) return <LoadingState label={t("settings.general.loading")} />;

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
      toast(res.error ?? t("settings.saveError"), "error");
    } else {
      toast(t("settings.org.saveSuccess"), "success");
      setDirty(false);
    }
  };

  return (
    <div className="panel-card-stack max-w-xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t("settings.org.title")}</h2>
        <p className="text-xs text-slate-500 mt-1">
          {t("settings.org.subtitle", { name: organization?.name ?? "—" })}
        </p>
      </div>

      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs p-4 space-y-4 font-sans">
        <AppSelect
          label={t("settings.org.preset")}
          value={orgPreset}
          onChange={(e) => applyPreset(e.target.value as OrgPreset)}
        >
          {presetOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </AppSelect>

        <div className="space-y-2">
          <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
            {t("settings.org.modules")}
          </p>
          {MODULE_KEYS.map(({ key, labelKey }) => (
            <label key={key} className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={modules[key]}
                onChange={() => toggleModule(key)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              {t(labelKey)}
            </label>
          ))}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={teachersCanManageDisciplines}
            onChange={(e) => {
              setTeachersCanManageDisciplines(e.target.checked);
              setDirty(true);
            }}
            className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          {t("settings.org.teachersEditDisciplines")}
        </label>

        <RequirePermission action="settings.manage" mode="hide">
          <div className="border-t border-slate-100 pt-4 space-y-2">
            <p className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold">
              {t("settings.org.roleOverrides")}
            </p>
            {ROLE_OVERRIDE_KEYS.map(({ key, labelKey, hintKey }) => {
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
                    onChange={(e) => {
                      setters[key](e.target.checked);
                      setDirty(true);
                    }}
                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 mt-0.5"
                  />
                  <span>
                    {t(labelKey)}
                    {hintKey ? (
                      <span className="block text-xs text-slate-400 mt-0.5">{t(hintKey)}</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>
        </RequirePermission>

        <div className="field-stack">
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block">
            {t("settings.org.lowBalanceThreshold")}
          </label>
          <input
            type="number"
            min={0}
            value={lowBalanceThreshold}
            onChange={(e) => {
              setLowBalanceThreshold(Number(e.target.value));
              setDirty(true);
            }}
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
            {isUpdating ? t("common.saving") : t("common.save")}
          </button>
        </RequirePermission>
      </div>
    </div>
  );
}
