import { useState } from "react";
import { Check, ChevronDown, Copy } from "lucide-react";
import type { CryptoPaymentMethod } from "../../lib/paymentConfig";
import { useI18n } from "../../hooks/useI18n";

interface CryptoPaymentCardsProps {
  methods: CryptoPaymentMethod[];
}

function CryptoCard({ method }: { method: CryptoPaymentMethod }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(method.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const amountLabel = [method.amount, method.currency].filter(Boolean).join(" ");

  return (
    <details className="group rounded-lg border border-slate-200 bg-white">
      <summary className="flex items-start justify-between gap-3 px-3 py-3 cursor-pointer list-none">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{method.coin}</p>
          <p className="text-xs text-slate-500 truncate">
            {[method.network, amountLabel].filter(Boolean).join(" · ")}
          </p>
        </div>
        <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-100">
        <button
          type="button"
          onClick={() => void copyAddress()}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 hover:border-indigo-200 hover:text-indigo-700 cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? t("common.copied") : t("license.payment.crypto.address")}
        </button>
        {amountLabel && (
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              {t("license.payment.field.amount")}
            </p>
            <p className="text-sm text-slate-800">{amountLabel}</p>
          </div>
        )}
        <code className="flex-1 text-[11px] leading-relaxed break-all text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-2">
          {method.address}
        </code>
        {method.qrImageUrl && (
          <div className="space-y-1">
            <p className="text-[10px] uppercase tracking-wider text-slate-400">
              {t("license.payment.field.qr")}
            </p>
            <img
              src={method.qrImageUrl}
              alt={t("license.payment.field.qr")}
              className="w-36 h-36 rounded-lg border border-slate-100 bg-white object-contain p-2"
            />
          </div>
        )}
      </div>
    </details>
  );
}

export default function CryptoPaymentCards({ methods }: CryptoPaymentCardsProps) {
  const { t } = useI18n();

  if (!methods.length) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
        {t("license.payment.crypto.title")}
      </p>
      <div className="space-y-2">
        {methods.map((method) => (
          <CryptoCard key={`${method.coin}-${method.network}-${method.address}`} method={method} />
        ))}
      </div>
    </div>
  );
}
