import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import type { ToastType } from "../../App";
import type { Discipline } from "../../types";
import { usePermissions } from "../../hooks/usePermissions";
import { useI18n } from "../../hooks/useI18n";
import { useOrganization } from "../../organization/OrganizationProvider";
import { normalizeOrgModules, shouldShowDisciplinePicker } from "../../lib/orgModules";
import AddDisciplineModal from "./AddDisciplineModal";
import AppSelect from "./AppSelect";

interface DisciplineSelectProps {
  label?: string;
  disciplines: Discipline[];
  value: string | "";
  onChange: (id: string) => void;
  toast: (msg: string, type?: ToastType) => void;
  required?: boolean;
  /** Include empty "all disciplines" option (for filters). */
  allowAll?: boolean;
  allOptionLabel?: string;
  /** Always show picker in lesson forms even with a single discipline or multi_discipline off. */
  alwaysShow?: boolean;
}

export default function DisciplineSelect({
  label,
  disciplines,
  value,
  onChange,
  toast,
  required = true,
  allowAll = false,
  allOptionLabel,
  alwaysShow = false,
}: DisciplineSelectProps) {
  const { t } = useI18n();
  const { settings } = useOrganization();
  const modules = normalizeOrgModules(settings?.modules);
  const show = alwaysShow
    ? disciplines.length > 0
    : shouldShowDisciplinePicker(modules, disciplines.length);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const { can } = usePermissions();
  const canAddDiscipline = can("disciplines.write");
  const resolvedLabel = label ?? t("common.discipline");

  useEffect(() => {
    if (disciplines.length === 0) return;
    const defaultId = disciplines[0].id;
    if (allowAll) return;
    if (!value || (!alwaysShow && !show && value !== defaultId)) {
      onChange(defaultId);
    }
  }, [show, alwaysShow, disciplines, value, onChange, allowAll]);

  if (!show) return null;

  return (
    <div className="field-stack">
      <AppSelect
        label={resolvedLabel}
        value={value}
        required={required}
        onChange={(e) => {
          const next = e.target.value;
          if (allowAll || next) onChange(next);
        }}
      >
        {allowAll ? (
          <option value="">{allOptionLabel ?? t("common.allDisciplines")}</option>
        ) : (
          <option value="" disabled>
            {t("ui.disciplineSelect.placeholder")}
          </option>
        )}
        {disciplines.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </AppSelect>
      {canAddDiscipline && (
        <>
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer mt-0.5"
          >
            <Plus className="w-3 h-3" />
            {t("ui.disciplineSelect.add")}
          </button>
          <AddDisciplineModal
            open={addModalOpen}
            onClose={() => setAddModalOpen(false)}
            toast={toast}
            onSuccess={(discipline) => onChange(discipline.id)}
          />
        </>
      )}
    </div>
  );
}
