import { FIXED_PAYMENT_METHOD_CODES } from "../../lib/platformPaymentContract";
import type { ManualPaymentConfig } from "../../lib/paymentConfig";
import { useI18n } from "../../hooks/useI18n";
import CryptoPaymentCards from "./CryptoPaymentCards";
import {
  BankTransferSection,
  MirPaymentSection,
  VietnameseBankTransferSection,
} from "./ManualPaymentSections";

interface QuotedPaymentDetailsProps {
  config: ManualPaymentConfig;
  methodCode: string;
  amount: string;
  currency: string;
  paymentDetails: string;
}

export default function QuotedPaymentDetails({
  config,
  methodCode,
  amount,
  currency,
  paymentDetails,
}: QuotedPaymentDetailsProps) {
  const { t } = useI18n();
  const amountLabel = [amount, currency].filter(Boolean).join(" ");

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-3">
        <p className="text-[10px] uppercase tracking-wider text-indigo-600 font-semibold">
          {t("license.purchase.quoteAmount")}
        </p>
        <p className="text-lg font-semibold text-slate-900 mt-0.5">{amountLabel || "—"}</p>
        <p className="text-[11px] text-slate-500 mt-1">{t("license.purchase.detailsFromQuote")}</p>
      </div>

      {methodCode === FIXED_PAYMENT_METHOD_CODES.bankTransfer ? (
        <BankTransferSection
          defaultOpen
          config={config.bankTransfer ? { ...config.bankTransfer, amount, currency } : null}
        />
      ) : null}
      {methodCode === FIXED_PAYMENT_METHOD_CODES.vietnameseBankTransfer ? (
        <VietnameseBankTransferSection
          defaultOpen
          config={
            config.vietnameseBankTransfer
              ? { ...config.vietnameseBankTransfer, amount, currency }
              : null
          }
        />
      ) : null}
      {methodCode === FIXED_PAYMENT_METHOD_CODES.mir ? (
        <MirPaymentSection
          defaultOpen
          config={config.mir ? { ...config.mir, amount, currency } : null}
        />
      ) : null}
      {config.crypto
        ?.filter((row) => row.id === methodCode)
        .map((row) => (
          <CryptoPaymentCards
            key={row.id}
            defaultOpen
            methods={[{ ...row, amount, currency }]}
          />
        ))}

      {paymentDetails ? (
        <pre className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          {paymentDetails}
        </pre>
      ) : null}
    </div>
  );
}
