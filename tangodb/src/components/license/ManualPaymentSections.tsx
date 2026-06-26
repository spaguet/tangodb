import type { BankTransferConfig, MirPaymentConfig } from "../../lib/paymentConfig";
import { useI18n } from "../../hooks/useI18n";

function DetailRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-sm text-slate-800 break-words">{value}</p>
    </div>
  );
}

export function BankTransferSection({ config }: { config: BankTransferConfig | null | undefined }) {
  const { t } = useI18n();

  if (!config?.beneficiary && !config?.ibanOrAccount) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {t("license.payment.bankTransfer.title")}
      </p>
      <div className="space-y-2">
        <DetailRow label={t("license.payment.field.beneficiary")} value={config.beneficiary} />
        <DetailRow label={t("license.payment.field.bank")} value={config.bankName} />
        <DetailRow label={t("license.payment.field.iban")} value={config.ibanOrAccount} />
        <DetailRow label="SWIFT / BIC" value={config.swiftOrBic} />
        <DetailRow
          label={t("license.payment.field.cardLast4")}
          value={config.cardLast4 ? `•••• ${config.cardLast4}` : undefined}
        />
        <DetailRow label={t("license.payment.field.note")} value={config.note} />
      </div>
    </div>
  );
}

export function MirPaymentSection({ config }: { config: MirPaymentConfig | null | undefined }) {
  const { t } = useI18n();

  if (!config?.recipient && !config?.phoneOrCard) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {t("license.payment.mir.title")}
      </p>
      <div className="space-y-2">
        <DetailRow label={t("license.payment.field.beneficiary")} value={config.recipient} />
        <DetailRow label={t("license.payment.field.phoneOrCard")} value={config.phoneOrCard} />
        <DetailRow label={t("license.payment.field.bank")} value={config.bankName} />
        <DetailRow label={t("license.payment.field.note")} value={config.note} />
      </div>
    </div>
  );
}
