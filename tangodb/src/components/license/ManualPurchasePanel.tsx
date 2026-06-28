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

export default function ManualPurchasePanel() {
  const { t } = useI18n();
  const { config, hasContent, isLoading, isError } = usePlatformPaymentConfig(true);

  if (isLoading) {
    return <LoadingState label={t("license.purchase.loadingMethods")} />;
  }

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4">
      <PurchaseActivationInstructions />

      {isError && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          {t("license.purchase.loadError")}
        </p>
      )}

      {!isError && !hasContent && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
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
