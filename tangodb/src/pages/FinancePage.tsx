import { Landmark } from "lucide-react";

export default function FinancePage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
        <Landmark className="w-7 h-7 text-indigo-500" />
      </div>
      <h2 className="text-base font-semibold text-slate-800">Финансы</h2>
      <p className="text-sm text-slate-500 mt-2 max-w-sm">
        Модуль в разработке. Журнал платежей и отчёты появятся в фазе R3.
      </p>
    </div>
  );
}
