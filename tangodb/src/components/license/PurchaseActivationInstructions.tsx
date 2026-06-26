import { ListOrdered } from "lucide-react";
import { getPurchaseActivationSteps } from "../../lib/paymentConfig";
import { useI18n } from "../../hooks/useI18n";

export default function PurchaseActivationInstructions() {
  const { t } = useI18n();
  const steps = getPurchaseActivationSteps(t);

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
        <ListOrdered className="w-3.5 h-3.5" />
        {t("license.purchase.instructionsTitle")}
      </p>
      <ol className="text-xs text-slate-600 space-y-1.5 list-decimal pl-4">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
