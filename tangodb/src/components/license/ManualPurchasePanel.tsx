import LoadingState from "../ui/LoadingState";
import { usePlatformPaymentConfig } from "../../hooks/usePlatformPaymentConfig";
import { useI18n } from "../../hooks/useI18n";
import CryptoPaymentCards from "./CryptoPaymentCards";
import {
  BankTransferSection,
  MirPaymentSection,
  VietnameseBankTransferSection,
} from "./ManualPaymentSections";
import PurchaseActivationInstructions from "./PurchaseActivationInstructions";
import PurchaseRequestPanel from "./PurchaseRequestPanel";

export default function ManualPurchasePanel() {
  const { t } = useI18n();
  const { config, hasContent, isLoading, isError } = usePlatformPaymentConfig(true);

  if (isLoading) {
    return <LoadingState label={t("license.purchase.loadingMethods")} />;
  }

  return (
    <div className="space-y-4 border-t border-ink-100 pt-4">
      <PurchaseActivationInstructions />
      <PurchaseRequestPanel contacts={config.contacts} />

      {isError && (
        <p className="text-xs text-garnet-600 bg-garnet-50 border border-garnet-100 rounded-lg px-3 py-2">
          {t("license.purchase.loadError")}
        </p>
      )}

      {!isError && !hasContent && (
        <p className="text-xs text-ink-500 bg-ink-50 border border-ink-200 rounded-lg px-3 py-2">
          {t("license.purchase.noMethodsConfigured")}
        </p>
      )}

      {!!config.crypto?.length && <CryptoPaymentCards methods={config.crypto} />}
      <BankTransferSection config={config.bankTransfer} />
      <VietnameseBankTransferSection config={config.vietnameseBankTransfer} />
      <MirPaymentSection config={config.mir} />
    </div>
  );
}
