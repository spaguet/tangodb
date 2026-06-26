import { ListOrdered } from "lucide-react";
import { PURCHASE_ACTIVATION_STEPS } from "../../lib/paymentConfig";

export default function PurchaseActivationInstructions() {
  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-3 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-indigo-700 flex items-center gap-1.5">
        <ListOrdered className="w-3.5 h-3.5" />
        Как активировать полную версию
      </p>
      <ol className="text-xs text-slate-600 space-y-1.5 list-decimal pl-4">
        {PURCHASE_ACTIVATION_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
