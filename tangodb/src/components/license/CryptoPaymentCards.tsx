import { useMemo, useState } from "react";
import QRCode from "react-qr-code";
import { Copy, Check } from "lucide-react";
import { buildCryptoQrValue, type CryptoPaymentMethod } from "../../lib/paymentConfig";

interface CryptoPaymentCardsProps {
  methods: CryptoPaymentMethod[];
}

function CryptoCard({ method }: { method: CryptoPaymentMethod }) {
  const [copied, setCopied] = useState(false);
  const qrValue = useMemo(() => buildCryptoQrValue(method), [method]);

  const copyAddress = async () => {
    await navigator.clipboard.writeText(method.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900">{method.coin}</p>
          {method.network && <p className="text-xs text-slate-500">{method.network}</p>}
        </div>
        <button
          type="button"
          onClick={() => void copyAddress()}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600 hover:border-indigo-200 hover:text-indigo-700 cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copied ? "Скопировано" : "Адрес"}
        </button>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="rounded-lg border border-slate-100 bg-white p-2 shrink-0">
          <QRCode value={qrValue} size={112} />
        </div>
        <code className="flex-1 text-[11px] leading-relaxed break-all text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-2 py-2">
          {method.address}
        </code>
      </div>
    </div>
  );
}

export default function CryptoPaymentCards({ methods }: CryptoPaymentCardsProps) {
  if (!methods.length) return null;

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Криптовалюта</p>
      <div className="space-y-2">
        {methods.map((method) => (
          <CryptoCard key={`${method.coin}-${method.network}-${method.address}`} method={method} />
        ))}
      </div>
    </div>
  );
}
