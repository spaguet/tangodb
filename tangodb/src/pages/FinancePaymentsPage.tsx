import { useMemo, useState } from "react";
import { Landmark, Search } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import { usePayments, PAYMENT_METHOD_LABELS, paymentSourceLabel } from "../hooks/usePayments";
import { formatCurrency } from "../lib/utils";
import type { Payment } from "../types";

function formatPaymentDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function PaymentRow({ payment }: { payment: Payment }) {
  return (
    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-2 sm:gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{payment.clientDisplay || "—"}</p>
        <p className="text-[10px] text-slate-400 font-sans mt-0.5">{formatPaymentDate(payment.createdAt)}</p>
      </div>
      <p className="text-xs text-slate-500 font-sans hidden sm:block">{paymentSourceLabel(payment)}</p>
      <p className="text-xs text-slate-500 font-sans hidden sm:block">{PAYMENT_METHOD_LABELS[payment.method]}</p>
      <p className="text-sm font-sans font-semibold text-indigo-700 text-right whitespace-nowrap">
        {formatCurrency(payment.amount)}
      </p>
    </div>
  );
}

export default function FinancePaymentsPage() {
  const [search, setSearch] = useState("");
  const paymentsQuery = usePayments();

  const filtered = useMemo(() => {
    const items = paymentsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((p) => p.clientDisplay.toLowerCase().includes(q));
  }, [paymentsQuery.data, search]);

  if (paymentsQuery.isLoading) return <LoadingState label="Загрузка журнала платежей..." />;
  if (paymentsQuery.isError) return <QueryErrorState error={paymentsQuery.error} />;

  const total = filtered.reduce((sum, p) => sum + p.amount, 0);

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">Журнал платежей</h2>
          </div>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по клиенту..."
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-20 text-center">
            <Landmark className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">Платежей пока нет</p>
          </div>
        ) : (
          <>
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
              <span>Клиент / дата</span>
              <span>Источник</span>
              <span>Способ</span>
              <span className="text-right">Сумма</span>
            </div>
            <div>{filtered.map((p) => <PaymentRow key={p.id} payment={p} />)}</div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center bg-slate-50/60">
              <span className="text-xs text-slate-500 font-sans">{filtered.length} записей</span>
              <span className="text-sm font-sans font-semibold text-slate-800">
                Итого: {formatCurrency(total)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
