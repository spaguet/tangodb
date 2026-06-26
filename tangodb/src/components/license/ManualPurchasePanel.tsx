import LoadingState from "../ui/LoadingState";
import { usePlatformPaymentConfig } from "../../hooks/usePlatformPaymentConfig";
import CryptoPaymentCards from "./CryptoPaymentCards";
import DeveloperContacts from "./DeveloperContacts";
import { BankTransferSection, MirPaymentSection } from "./ManualPaymentSections";
import PurchaseActivationInstructions from "./PurchaseActivationInstructions";

export default function ManualPurchasePanel() {
  const { config, hasContent, isLoading, isError } = usePlatformPaymentConfig(true);

  if (isLoading) {
    return <LoadingState label="Загрузка способов оплаты..." />;
  }

  return (
    <div className="space-y-4 border-t border-slate-100 pt-4">
      <PurchaseActivationInstructions />

      {isError && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
          Не удалось загрузить реквизиты. Попробуйте обновить страницу или свяжитесь с разработчиком.
        </p>
      )}

      {!isError && !hasContent && (
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          Реквизиты оплаты пока не настроены. Свяжитесь с разработчиком через контакты ниже или дождитесь письма с
          инструкциями.
        </p>
      )}

      {!!config.crypto?.length && <CryptoPaymentCards methods={config.crypto} />}
      <BankTransferSection config={config.bankTransfer} />
      <MirPaymentSection config={config.mir} />
      <DeveloperContacts contacts={config.contacts} />
    </div>
  );
}
