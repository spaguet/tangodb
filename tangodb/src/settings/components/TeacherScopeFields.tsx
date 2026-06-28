import { useDisciplines } from "../../hooks/useDisciplines";
import { useLocations } from "../../hooks/useLocations";
import { useI18n } from "../../hooks/useI18n";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules } from "../../lib/orgModules";
import { isTeacherScopeConfigured } from "../../lib/teacherScope";
import type { TeacherScope } from "../../types/organization";

const labelCls =
  "text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block";

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

  const patch = (partial: Partial<TeacherScope>) => {
    onChange({ ...value, ...partial });
  };

  const toggleDiscipline = (id: string) => {
    const next = value.discipline_ids.includes(id)
      ? value.discipline_ids.filter((item) => item !== id)
      : [...value.discipline_ids, id];
    patch({ discipline_ids: next });
  };

  const toggleLocation = (id: string) => {
    const next = value.location_ids.includes(id)
      ? value.location_ids.filter((item) => item !== id)
      : [...value.location_ids, id];
    patch({ location_ids: next });
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <div>
        <p className="text-xs font-semibold text-slate-700">{t("team.scope.title")}</p>
        <p className="text-[11px] text-slate-500 mt-0.5">{t("team.scope.hint")}</p>
      </div>

      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={value.all_disciplines}
          disabled={disabled}
          onChange={(e) => patch({ all_disciplines: e.target.checked })}
          className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span className="text-sm text-slate-700">{t("team.scope.allDisciplines")}</span>
      </label>

      {!value.all_disciplines && (
        <div className="space-y-1.5 pl-1">
          <span className={labelCls}>{t("team.scope.disciplines")}</span>
          {disciplinesQuery.isLoading ? (
            <p className="text-xs text-slate-400">{t("common.loading.default")}</p>
          ) : (disciplinesQuery.data ?? []).length === 0 ? (
            <p className="text-xs text-slate-400">{t("team.scope.noDisciplines")}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {(disciplinesQuery.data ?? []).map((discipline) => {
                const checked = value.discipline_ids.includes(discipline.id);
                return (
                  <label
                    key={discipline.id}
                    className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs cursor-pointer ${
                      checked
                        ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                        : "border-slate-200 bg-white text-slate-600"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => toggleDiscipline(discipline.id)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    {discipline.name}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {modules.locations && (
        <>
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={value.all_locations}
              disabled={disabled}
              onChange={(e) => patch({ all_locations: e.target.checked })}
              className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span className="text-sm text-slate-700">{t("team.scope.allLocations")}</span>
          </label>

          {!value.all_locations && (
            <div className="space-y-1.5 pl-1">
              <span className={labelCls}>{t("team.scope.locations")}</span>
              {locationsQuery.isLoading ? (
                <p className="text-xs text-slate-400">{t("common.loading.default")}</p>
              ) : (locationsQuery.data ?? []).length === 0 ? (
                <p className="text-xs text-slate-400">{t("team.scope.noLocations")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(locationsQuery.data ?? []).map((location) => {
                    const checked = value.location_ids.includes(location.id);
                    return (
                      <label
                        key={location.id}
                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs cursor-pointer ${
                          checked
                            ? "border-indigo-200 bg-indigo-50 text-indigo-800"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggleLocation(location.id)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
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
          className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        />
        <span className="text-sm text-slate-700">{t("team.scope.allClients")}</span>
      </label>

      {!isTeacherScopeConfigured(value) && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
          {t("team.scope.emptyWarning")}
        </p>
      )}
    </div>
  );
}
