import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type {
  BankTransferConfig,
  MirPaymentConfig,
  VietnameseBankTransferConfig,
} from "../../lib/paymentConfig";
import { useI18n } from "../../hooks/useI18n";
import { QrImagePreview } from "./QrImagePreview";

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-sm text-slate-800 break-words">{value}</p>
    </div>
  );
}

function AmountRow({ amount, currency }: { amount?: string; currency?: string }) {
  const { t } = useI18n();
  if (!amount && !currency) return null;
  return <DetailRow label={t("license.payment.field.amount")} value={[amount, currency].filter(Boolean).join(" ")} />;
}

function PaymentDetails({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-slate-200 bg-white">
      <summary className="flex items-center justify-between gap-3 px-3 py-3 cursor-pointer list-none">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</p>
          {subtitle && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{subtitle}</p>}
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-2 border-t border-slate-100">{children}</div>
    </details>
  );
}

export function BankTransferSection({ config }: { config: BankTransferConfig | null | undefined }) {
  const { t } = useI18n();

  if (!config?.beneficiary && !config?.ibanOrAccount) return null;

  return (
    <PaymentDetails title={t("license.payment.bankTransfer.title")} subtitle={config.bankName}>
      <AmountRow amount={config.amount} currency={config.currency} />
      <DetailRow label={t("license.payment.field.beneficiary")} value={config.beneficiary} />
      <DetailRow label={t("license.payment.field.bank")} value={config.bankName} />
      <DetailRow label={t("license.payment.field.iban")} value={config.ibanOrAccount} />
      <DetailRow label="SWIFT / BIC" value={config.swiftOrBic} />
      <DetailRow
        label={t("license.payment.field.cardLast4")}
        value={config.cardLast4 ? `•••• ${config.cardLast4}` : undefined}
      />
      <DetailRow label={t("license.payment.field.note")} value={config.note} />
      <QrImagePreview value={config.qrImageUrl} />
    </PaymentDetails>
  );
}

export function MirPaymentSection({ config }: { config: MirPaymentConfig | null | undefined }) {
  const { t } = useI18n();

  if (!config?.recipient && !config?.phoneOrCard) return null;

  return (
    <PaymentDetails title={t("license.payment.mir.title")} subtitle={config.bankName}>
      <AmountRow amount={config.amount} currency={config.currency} />
      <DetailRow label={t("license.payment.field.beneficiary")} value={config.recipient} />
      <DetailRow label={t("license.payment.field.phoneOrCard")} value={config.phoneOrCard} />
      <DetailRow label={t("license.payment.field.bank")} value={config.bankName} />
      <DetailRow label={t("license.payment.field.note")} value={config.note} />
      <QrImagePreview value={config.qrImageUrl} />
    </PaymentDetails>
  );
}

export function VietnameseBankTransferSection({
  config,
}: {
  config: VietnameseBankTransferConfig | null | undefined;
}) {
  const { t } = useI18n();

  if (!config?.beneficiary && !config?.accountNumber) return null;

  return (
    <PaymentDetails title={t("license.payment.vietnameseBankTransfer.title")} subtitle={config.bankName}>
      <AmountRow amount={config.amount} currency={config.currency} />
      <DetailRow label={t("license.payment.field.beneficiary")} value={config.beneficiary} />
      <DetailRow label={t("license.payment.field.bank")} value={config.bankName} />
      <DetailRow label={t("license.payment.field.accountNumber")} value={config.accountNumber} />
      <DetailRow label={t("license.payment.field.note")} value={config.note} />
      <QrImagePreview value={config.qrImageUrl} />
    </PaymentDetails>
  );
}
