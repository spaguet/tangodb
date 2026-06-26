import DisciplinesPanel from "../../components/DisciplinesPanel";
import { useToast } from "../../App";
import { useI18n } from "../../hooks/useI18n";

export default function DisciplinesSettingsPage() {
  const toast = useToast();
  const { t } = useI18n();

  return (
    <div className="panel-card-stack max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{t("settings.disciplines.title")}</h2>
        <p className="text-xs text-slate-500 mt-1">{t("settings.disciplines.subtitle")}</p>
      </div>
      <DisciplinesPanel toast={toast} />
    </div>
  );
}
