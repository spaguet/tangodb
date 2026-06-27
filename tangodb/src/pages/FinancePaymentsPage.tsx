import { useMemo, useState } from "react";
import { Landmark, Search } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import AppSelect from "../components/ui/AppSelect";
import DatePickerField from "../components/ui/DatePickerField";
import {
  usePayments,
  getPaymentMethodLabel,
  paymentSourceLabel,
} from "../hooks/usePayments";
import { useI18n } from "../hooks/useI18n";
import { formatCurrency } from "../lib/utils";
import type { Payment, PaymentMethod } from "../types";

type PaymentSourceFilter = "all" | "subscription" | "personal_lesson";
type PaymentMethodFilter = "all" | PaymentMethod;

const PAYMENT_METHODS: PaymentMethod[] = ["cash", "transfer", "card", "other"];

function PaymentRow({
  payment,
  formatDateTime,
  translate,
}: {
  payment: Payment;
  formatDateTime: ReturnType<typeof useI18n>["formatDateTime"];
  translate: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-2 sm:gap-3 items-center px-3 py-3 border-b border-slate-100 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{payment.clientDisplay || "—"}</p>
        <p className="text-[10px] text-slate-400 font-sans mt-0.5">
          {formatDateTime(payment.createdAt, {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
      <p className="text-xs text-slate-500 font-sans hidden sm:block">{paymentSourceLabel(payment, translate)}</p>
      <p className="text-xs text-slate-500 font-sans hidden sm:block">
        {getPaymentMethodLabel(payment.method, translate)}
      </p>
      <p className="text-sm font-sans font-semibold text-indigo-700 text-right whitespace-nowrap">
        {formatCurrency(payment.amount)}
      </p>
    </div>
  );
}

function matchesSourceFilter(payment: Payment, source: PaymentSourceFilter): boolean {
  if (source === "all") return true;
  if (source === "subscription") return payment.subscriptionId != null;
  return payment.personalLessonId != null;
}

export default function FinancePaymentsPage() {
  const { t, formatDateTime, plural } = useI18n();
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sourceFilter, setSourceFilter] = useState<PaymentSourceFilter>("all");
  const [methodFilter, setMethodFilter] = useState<PaymentMethodFilter>("all");

  const paymentsFilter = useMemo(
    () => (dateFrom || dateTo ? { dateFrom: dateFrom || undefined, dateTo: dateTo || undefined } : undefined),
    [dateFrom, dateTo]
  );
  const paymentsQuery = usePayments(paymentsFilter);

  const filtered = useMemo(() => {
    let items = paymentsQuery.data ?? [];

    if (sourceFilter !== "all") {
      items = items.filter((p) => matchesSourceFilter(p, sourceFilter));
    }
    if (methodFilter !== "all") {
      items = items.filter((p) => p.method === methodFilter);
    }

    const q = search.trim().toLowerCase();
    if (q) {
      items = items.filter((p) => p.clientDisplay.toLowerCase().includes(q));
    }

    return items;
  }, [paymentsQuery.data, sourceFilter, methodFilter, search]);

  if (paymentsQuery.isLoading) return <LoadingState label={t("finance.payments.loading")} />;
  if (paymentsQuery.isError) return <QueryErrorState error={paymentsQuery.error} />;

  const total = filtered.reduce((sum, p) => sum + p.amount, 0);
  const hasAnyPayments = (paymentsQuery.data?.length ?? 0) > 0;
  const hasActiveFilters =
    Boolean(dateFrom || dateTo) || sourceFilter !== "all" || methodFilter !== "all" || search.trim().length > 0;

  return (
    <div className="panel-page-stack">
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Landmark className="w-4 h-4 text-indigo-500" />
            <h2 className="font-sans text-sm font-semibold text-slate-800">{t("finance.payments.title")}</h2>
          </div>
          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("finance.payments.search")}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            />
          </div>
        </div>

        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <DatePickerField
              label={t("common.dateFrom")}
              value={dateFrom}
              onChange={setDateFrom}
              className="min-w-0"
            />
            <DatePickerField
              label={t("common.dateTo")}
              value={dateTo}
              onChange={setDateTo}
              min={dateFrom || undefined}
              className="min-w-0"
            />
            <AppSelect
              label={t("common.source")}
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as PaymentSourceFilter)}
            >
              <option value="all">{t("common.all")}</option>
              <option value="subscription">{t("common.payment.source.subscription")}</option>
              <option value="personal_lesson">{t("common.payment.source.personalLesson")}</option>
            </AppSelect>
            <AppSelect
              label={t("common.method")}
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as PaymentMethodFilter)}
            >
              <option value="all">{t("common.all")}</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {getPaymentMethodLabel(method, t)}
                </option>
              ))}
            </AppSelect>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="py-20 text-center">
            <Landmark className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              {hasAnyPayments && hasActiveFilters
                ? t("finance.payments.emptyFiltered")
                : t("finance.payments.empty")}
            </p>
          </div>
        ) : (
          <>
            <div className="hidden sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto] gap-3 px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider font-semibold text-slate-400 font-sans">
              <span>{t("common.clientDate")}</span>
              <span>{t("common.source")}</span>
              <span>{t("common.method")}</span>
              <span className="text-right">{t("common.amount")}</span>
            </div>
            <div>
              {filtered.map((p) => (
                <PaymentRow key={p.id} payment={p} formatDateTime={formatDateTime} translate={t} />
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-between items-center bg-slate-50/60">
              <span className="text-xs text-slate-500 font-sans">
                {plural(filtered.length, [
                  t("common.records.one", { count: filtered.length }),
                  t("common.records.few", { count: filtered.length }),
                  t("common.records.many", { count: filtered.length }),
                ])}
              </span>
              <span className="text-sm font-sans font-semibold text-slate-800">
                {t("finance.payments.total", { amount: formatCurrency(total) })}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
