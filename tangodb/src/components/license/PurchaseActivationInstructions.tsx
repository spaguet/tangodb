import { ListOrdered, MessageCircle } from "lucide-react";
import { getPurchaseActivationSteps } from "../../lib/paymentConfig";
import { usePlatformPaymentConfig } from "../../hooks/usePlatformPaymentConfig";
import { useI18n } from "../../hooks/useI18n";
import DeveloperContacts from "./DeveloperContacts";

export default function PurchaseActivationInstructions() {
  const { t } = useI18n();
  const { config } = usePlatformPaymentConfig(true);
  const steps = getPurchaseActivationSteps(t);

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gold-100 bg-gold-50/10 px-3 py-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-gold-700 flex items-center gap-1.5">
          <MessageCircle className="w-3.5 h-3.5" />
          {t("license.purchase.developerKeyTitle")}
        </p>
        <p className="text-xs text-ink-600 leading-relaxed">{t("license.purchase.developerKeyIntro")}</p>
        <DeveloperContacts contacts={config.contacts} embedded />
      </div>

      <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-3 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-600 flex items-center gap-1.5">
          <ListOrdered className="w-3.5 h-3.5" />
          {t("license.purchase.instructionsTitle")}
        </p>
        <ol className="text-xs text-ink-600 space-y-1.5 list-decimal pl-4">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
