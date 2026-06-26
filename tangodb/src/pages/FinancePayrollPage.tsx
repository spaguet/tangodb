import { Wallet } from "lucide-react";
import { useI18n } from "../hooks/useI18n";

export default function FinancePayrollPage() {
  const { t } = useI18n();

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs">
        <div className="py-20 text-center px-4">
          <Wallet className="w-8 h-8 text-slate-300 mx-auto mb-3" />
          <h2 className="font-sans text-sm font-semibold text-slate-800 mb-1">{t("finance.payroll.title")}</h2>
          <p className="text-sm text-slate-500 max-w-md mx-auto">{t("finance.payroll.comingSoon")}</p>
        </div>
      </div>
    </div>
  );
}
