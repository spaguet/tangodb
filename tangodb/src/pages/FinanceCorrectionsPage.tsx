import { useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import DatePickerField from "../components/ui/DatePickerField";
import { useCorrectionsReport } from "../hooks/usePaymentCorrections";
import { useI18n } from "../hooks/useI18n";
import { formatCurrency } from "../lib/utils";
import { getPaymentMethodLabel } from "../hooks/usePayments";
import { paymentStatusLabelKey } from "../lib/paymentCorrection";

export default function FinanceCorrectionsPage() {
  const { t, formatDateTime, formatDate } = useI18n();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");

  const reportQuery = useCorrectionsReport(dateFrom || undefined, dateTo || undefined);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!reportQuery.data) return { payments: [], attendance: [] };
    if (!q) return reportQuery.data;

    return {
      payments: reportQuery.data.payments.filter(
        (row) =>
          row.clientDisplay.toLowerCase().includes(q) ||
          String(row.operationNumber ?? "").includes(q) ||
          (row.reasonCode ?? "").toLowerCase().includes(q)
      ),
      attendance: reportQuery.data.attendance.filter(
        (row) =>
          row.clientDisplay.toLowerCase().includes(q) ||
          String(row.operationNumber ?? "").includes(q) ||
          (row.reasonCode ?? "").toLowerCase().includes(q)
      ),
    };
  }, [reportQuery.data, search]);

  if (reportQuery.isLoading) return <LoadingState />;
  if (reportQuery.isError) {
    return <QueryErrorState error={reportQuery.error instanceof Error ? reportQuery.error : null} />;
  }

  const totalRows = filtered.payments.length + filtered.attendance.length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History size={18} className="text-indigo-600" />
        <h2 className="text-lg font-semibold text-slate-900">{t("corrections.page.title")}</h2>
      </div>
      <p className="text-sm text-slate-500">{t("corrections.page.subtitle")}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DatePickerField label={t("corrections.page.dateFrom")} value={dateFrom} onChange={setDateFrom} />
        <DatePickerField label={t("corrections.page.dateTo")} value={dateTo} onChange={setDateTo} />
        <div>
          <label className="text-[10px] text-slate-400 font-sans uppercase tracking-wider font-semibold block mb-1">
            {t("corrections.page.searchPlaceholder")}
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-sm"
              placeholder={t("corrections.page.searchPlaceholder")}
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400">{t("corrections.page.count", { count: totalRows })}</p>

      {totalRows === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
          {t("corrections.page.empty")}
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white">
          {filtered.payments.map((row) => (
            <div
              key={`p-${row.id}`}
              className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 px-4 py-3 border-b border-slate-100 last:border-b-0"
            >
              <div>
                <p className="text-xs font-semibold text-indigo-700 uppercase">{t("corrections.page.kindPayment")}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {row.operationNumber != null ? `#${row.operationNumber}` : "—"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{row.clientDisplay}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {row.operationKind === "storno" ? t("corrections.page.storno") : t("corrections.page.correction")} ·{" "}
                  {getPaymentMethodLabel(row.method, t)} ·{" "}
                  {t(paymentStatusLabelKey(row.relatedStatus) as Parameters<typeof t>[0])}
                </p>
                {row.reasonCode && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {row.reasonCode}
                    {row.reasonComment ? ` — ${row.reasonComment}` : ""}
                  </p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  {row.authorName ?? "—"} ·{" "}
                  {formatDateTime(row.createdAt, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <p
                className={`text-sm font-semibold text-right whitespace-nowrap ${
                  row.operationKind === "storno" ? "text-rose-600" : "text-slate-800"
                }`}
              >
                {row.operationKind === "storno" ? "−" : ""}
                {formatCurrency(row.amount)}
              </p>
            </div>
          ))}

          {filtered.attendance.map((row) => (
            <div
              key={`a-${row.id}`}
              className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 px-4 py-3 border-b border-slate-100 last:border-b-0"
            >
              <div>
                <p className="text-xs font-semibold text-violet-700 uppercase">{t("corrections.page.kindAttendance")}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {row.operationNumber != null ? `#${row.operationNumber}` : "—"}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{row.clientDisplay}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {formatDate(row.occurrenceDate)} · {row.oldStatus ?? "—"} → {row.newStatus}
                  {row.isUndo ? ` · ${t("corrections.page.undo")}` : ""}
                </p>
                {row.reasonCode && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {row.reasonCode}
                    {row.reasonComment ? ` — ${row.reasonComment}` : ""}
                  </p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  {row.authorName ?? "—"} ·{" "}
                  {formatDateTime(row.createdAt, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
