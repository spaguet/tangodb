import type { BankTransferConfig, MirPaymentConfig } from "../../lib/paymentConfig";

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
  if (!config?.beneficiary && !config?.ibanOrAccount) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        Банковский перевод / MasterCard
      </p>
      <div className="space-y-2">
        <DetailRow label="Получатель" value={config.beneficiary} />
        <DetailRow label="Банк" value={config.bankName} />
        <DetailRow label="Счёт / IBAN" value={config.ibanOrAccount} />
        <DetailRow label="SWIFT / BIC" value={config.swiftOrBic} />
        <DetailRow label="Карта (last4)" value={config.cardLast4 ? `•••• ${config.cardLast4}` : undefined} />
        <DetailRow label="Комментарий" value={config.note} />
      </div>
    </div>
  );
}

export function MirPaymentSection({ config }: { config: MirPaymentConfig | null | undefined }) {
  if (!config?.recipient && !config?.phoneOrCard) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">МИР</p>
      <div className="space-y-2">
        <DetailRow label="Получатель" value={config.recipient} />
        <DetailRow label="Телефон / карта" value={config.phoneOrCard} />
        <DetailRow label="Банк" value={config.bankName} />
        <DetailRow label="Комментарий" value={config.note} />
      </div>
    </div>
  );
}
