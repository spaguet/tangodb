import { useState } from "react";
import { Plus } from "lucide-react";
import DisciplinesPanel from "../../components/DisciplinesPanel";
import AddDisciplineModal from "../../components/ui/AddDisciplineModal";
import RequirePermission from "../../components/RequirePermission";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";

export default function DisciplinesSettingsPage() {
  const toast = useToast();
  const { t } = useI18n();
  const [addModalOpen, setAddModalOpen] = useState(false);

  return (
    <div className="panel-card-stack max-w-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{t("settings.disciplines.title")}</h2>
          <p className="text-xs text-slate-500 mt-1">{t("settings.disciplines.subtitle")}</p>
        </div>
        <RequirePermission action="disciplines.write" mode="hide">
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-lg hover:bg-indigo-100 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("common.add")}
          </button>
        </RequirePermission>
      </div>
      <DisciplinesPanel toast={toast} />
      <AddDisciplineModal open={addModalOpen} onClose={() => setAddModalOpen(false)} toast={toast} />
    </div>
  );
}
