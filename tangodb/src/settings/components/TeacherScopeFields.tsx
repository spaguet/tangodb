import { useMemo } from "react";
import { useDisciplines } from "../../hooks/useDisciplines";
import { useLocations } from "../../hooks/useLocations";
import { useScheduleGroups } from "../../hooks/useScheduleGroups";
import { useI18n } from "../../hooks/useI18n";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules } from "../../lib/orgModules";
import { isTeacherScopeConfigured } from "../../lib/teacherScope";
import type { TeacherScope } from "../../types/organization";
import GroupCheckboxDropdown from "../../components/ui/GroupCheckboxDropdown";

const labelCls =
  "text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block";

interface TeacherScopeFieldsProps {
  value: TeacherScope;
  onChange: (scope: TeacherScope) => void;
  disabled?: boolean;
}

export default function TeacherScopeFields({ value, onChange, disabled = false }: TeacherScopeFieldsProps) {
  const { t } = useI18n();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);
  const disciplinesQuery = useDisciplines();
  const locationsQuery = useLocations();
  const scheduleGroupsQuery = useScheduleGroups();

  const patch = (partial: Partial<TeacherScope>) => {
    onChange({ ...value, ...partial });
  };

  const locationNameById = useMemo(
    () =>
      Object.fromEntries((locationsQuery.data ?? []).map((location) => [location.id, location.name])),
    [locationsQuery.data]
  );

  const groupOptions = useMemo(
    () =>
      (scheduleGroupsQuery.data ?? []).map((group) => {
        const locationPrefix = group.locationId
          ? `${locationNameById[group.locationId] ?? t("team.scope.unknownLocation")} · `
          : "";
        return {
          key: group.id,
          label: `${locationPrefix}${group.name.trim() || t("team.scope.defaultGroup")}`,
        };
      }),
    [scheduleGroupsQuery.data, locationNameById, t]
  );

  const disciplineOptions = useMemo(
    () =>
      (disciplinesQuery.data ?? []).map((discipline) => ({
        key: discipline.id,
        label: discipline.name,
      })),
    [disciplinesQuery.data]
  );

  return (
    <div className="space-y-3 rounded-xl border border-ink-100 bg-ink-50/70 p-3">
      <div>
        <p className="text-xs font-semibold text-ink-700">{t("team.scope.title")}</p>
        <p className="text-[11px] text-ink-500 mt-0.5">{t("team.scope.hint")}</p>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.all_groups}
            disabled={disabled}
            onChange={(e) => patch({ all_groups: e.target.checked })}
            className="mt-0.5 rounded border-ink-300 text-gold-700 focus:ring-gold-500"
          />
          <span className="text-sm text-ink-700">{t("team.scope.allGroups")}</span>
        </label>

        {!value.all_groups && (
          <GroupCheckboxDropdown
            label={t("team.scope.groupsAccess")}
            options={groupOptions}
            selectedKeys={value.schedule_group_ids}
            onChange={(schedule_group_ids) => patch({ schedule_group_ids })}
            disabled={disabled}
            emptyMessage={t("team.scope.noGroups")}
          />
        )}
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={value.all_disciplines}
            disabled={disabled}
            onChange={(e) => patch({ all_disciplines: e.target.checked })}
            className="mt-0.5 rounded border-ink-300 text-gold-700 focus:ring-gold-500"
          />
          <span className="text-sm text-ink-700">{t("team.scope.allSalesDisciplines")}</span>
        </label>

        {!value.all_disciplines && (
          <GroupCheckboxDropdown
            label={t("team.scope.salesDisciplinesAccess")}
            options={disciplineOptions}
            selectedKeys={value.discipline_ids}
            onChange={(discipline_ids) => patch({ discipline_ids })}
            disabled={disabled}
            emptyMessage={t("team.scope.noDisciplines")}
          />
        )}
      </div>

      {modules.locations && (
        <>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value.all_locations}
              disabled={disabled}
              onChange={(e) => patch({ all_locations: e.target.checked })}
              className="mt-0.5 rounded border-ink-300 text-gold-700 focus:ring-gold-500"
            />
            <span className="text-sm text-ink-700">{t("team.scope.allLocations")}</span>
          </label>

          {!value.all_locations && (
            <div className="space-y-1.5 pl-1">
              <span className={labelCls}>{t("team.scope.locations")}</span>
              {locationsQuery.isLoading ? (
                <p className="text-xs text-ink-500">{t("common.loading.default")}</p>
              ) : (locationsQuery.data ?? []).length === 0 ? (
                <p className="text-xs text-ink-500">{t("team.scope.noLocations")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(locationsQuery.data ?? []).map((location) => {
                    const checked = value.location_ids.includes(location.id);
                    return (
                      <label
                        key={location.id}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs cursor-pointer ${
                          checked
                            ? "border-gold-200 bg-gold-50 text-gold-800"
                            : "border-ink-200 bg-white text-ink-600"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => {
                            const next = checked
                              ? value.location_ids.filter((id) => id !== location.id)
                              : [...value.location_ids, location.id];
                            patch({ location_ids: next });
                          }}
                          className="rounded border-ink-300 text-gold-700 focus:ring-gold-500"
                        />
                        {location.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.can_view_all_clients}
          disabled={disabled}
          onChange={(e) => patch({ can_view_all_clients: e.target.checked })}
          className="mt-0.5 rounded border-ink-300 text-gold-700 focus:ring-gold-500"
        />
        <span className="text-sm text-ink-700">{t("team.scope.allClients")}</span>
      </label>

      {!isTeacherScopeConfigured(value) && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
          {t("team.scope.emptyWarning")}
        </p>
      )}
    </div>
  );
}
