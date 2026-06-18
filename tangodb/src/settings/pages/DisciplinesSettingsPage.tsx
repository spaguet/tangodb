import DisciplinesPanel from "../../components/DisciplinesPanel";
import { useToast } from "../../App";

export default function DisciplinesSettingsPage() {
  const toast = useToast();

  return (
    <div className="panel-card-stack max-w-2xl">
      <div>
        <h2 className="text-base font-semibold text-slate-900">Направления</h2>
        <p className="text-xs text-slate-500 mt-1">Дисциплины и описания для расписания и абонементов.</p>
      </div>
      <DisciplinesPanel toast={toast} />
    </div>
  );
}
