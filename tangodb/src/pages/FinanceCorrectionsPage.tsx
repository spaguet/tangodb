import { useMemo, useState } from "react";
import { History, Search } from "lucide-react";
import LoadingState from "../components/ui/LoadingState";
import QueryErrorState from "../components/ui/QueryErrorState";
import DatePickerField from "../components/ui/DatePickerField";
import { searchFieldCls } from "../components/ui/AppSelect";
import { useCorrectionsReport } from "../hooks/usePaymentCorrections";
import { useI18n } from "../hooks/useI18n";
import { formatCurrency, currentYearMonth } from "../lib/utils";
import { monthDateRange } from "../lib/financeReports";
import { getPaymentMethodLabel } from "../hooks/usePayments";
import {
  filterVisibleCorrectionPayments,
  formatOperationNumber,
  paymentCorrectionActionLabelKey,
  paymentCorrectionReasonLabelKey,
  paymentStatusLabelKey,
  type CorrectionReportPaymentRow,
} from "../lib/paymentCorrection";

function KindBadge({
  kind,
  operationNumber,
  tone = "indigo",
}: {
  kind: string;
  operationNumber: number | null;
  tone?: "indigo" | "violet";
}) {
  const opLabel = formatOperationNumber(operationNumber);
  const toneClass = tone === "violet" ? "text-lavender-700" : "text-gold-700";
  return (
    <p className={`text-xs font-semibold uppercase whitespace-nowrap ${toneClass}`}>
      {kind}
      {operationNumber != null && (
        <span className="text-ink-500 font-normal normal-case ml-1">{opLabel}</span>
      )}
    </p>
  );
}

function PaymentCorrectionRow({
  row,
  originalPayment,
  t,
  formatDateTime,
  kindLabel,
}: {
  row: CorrectionReportPaymentRow;
  originalPayment: CorrectionReportPaymentRow | null;
  t: ReturnType<typeof useI18n>["t"];
  formatDateTime: ReturnType<typeof useI18n>["formatDateTime"];
  kindLabel?: string;
}) {
  const actionKey = paymentCorrectionActionLabelKey(row);
  const reasonKey = paymentCorrectionReasonLabelKey(row.reasonCode);
  const isStorno = row.operationKind === "storno";
  const contextDate = originalPayment?.createdAt;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 px-4 py-3 border-b border-ink-100 last:border-b-0">
      <div>
        <KindBadge kind={kindLabel ?? t("corrections.page.kindPayment")} operationNumber={row.operationNumber} />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-800 truncate">{row.clientDisplay}</p>
        <p className="text-xs text-ink-500 mt-0.5">
          {t(actionKey as Parameters<typeof t>[0])} · {getPaymentMethodLabel(row.method, t)}
          {!isStorno && (
            <>
              {" · "}
              {t(paymentStatusLabelKey(row.relatedStatus) as Parameters<typeof t>[0])}
            </>
          )}
        </p>
        {isStorno && contextDate && (
          <p className="text-xs text-ink-500 mt-0.5">
            {t("corrections.page.stornoContext", {
              date: formatDateTime(contextDate, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </p>
        )}
        {row.replacesPaymentId && contextDate && (
          <p className="text-xs text-ink-500 mt-0.5">
            {t("corrections.page.replacementContext", {
              date: formatDateTime(contextDate, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              }),
            })}
          </p>
        )}
        {reasonKey && (
          <p className="text-xs text-ink-500 mt-0.5">
            {t(reasonKey as Parameters<typeof t>[0])}
            {row.reasonComment ? ` — ${row.reasonComment}` : ""}
          </p>
        )}
        <p className="text-[10px] text-ink-500 mt-1">
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
          isStorno ? "text-garnet-600" : "text-ink-800"
        }`}
      >
        {isStorno ? "−" : ""}
        {formatCurrency(row.amount)}
      </p>
    </div>
  );
}

export default function FinanceCorrectionsPage() {
  const { t, formatDateTime, formatDate, plural } = useI18n();
  const defaultRange = monthDateRange(currentYearMonth());
  const [dateFrom, setDateFrom] = useState(defaultRange.dateFrom);
  const [dateTo, setDateTo] = useState(defaultRange.dateTo);
  const [search, setSearch] = useState("");

  const reportQuery = useCorrectionsReport(dateFrom || undefined, dateTo || undefined);

  const paymentById = useMemo(() => {
    const map = new Map<string, CorrectionReportPaymentRow>();
    for (const row of reportQuery.data?.payments ?? []) {
      map.set(row.id, row);
    }
    for (const row of reportQuery.data?.rentalPayments ?? []) {
      map.set(row.id, row);
    }
    return map;
  }, [reportQuery.data?.payments, reportQuery.data?.rentalPayments]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visiblePayments = filterVisibleCorrectionPayments(reportQuery.data?.payments ?? []);
    const visibleRentalPayments = filterVisibleCorrectionPayments(
      reportQuery.data?.rentalPayments ?? []
    );

    if (!reportQuery.data) return { payments: [], rentalPayments: [], attendance: [] };

    const payments = !q
      ? visiblePayments
      : visiblePayments.filter(
          (row) =>
            row.clientDisplay.toLowerCase().includes(q) ||
            String(row.operationNumber ?? "").includes(q) ||
            (row.reasonCode ?? "").toLowerCase().includes(q)
        );

    const rentalPayments = !q
      ? visibleRentalPayments
      : visibleRentalPayments.filter(
          (row) =>
            row.clientDisplay.toLowerCase().includes(q) ||
            String(row.operationNumber ?? "").includes(q) ||
            (row.reasonCode ?? "").toLowerCase().includes(q)
        );

    const attendance = !q
      ? reportQuery.data.attendance
      : reportQuery.data.attendance.filter(
          (row) =>
            row.clientDisplay.toLowerCase().includes(q) ||
            String(row.operationNumber ?? "").includes(q) ||
            (row.reasonCode ?? "").toLowerCase().includes(q)
        );

    return { payments, rentalPayments, attendance };
  }, [reportQuery.data, search]);

  if (reportQuery.isLoading) return <LoadingState />;
  if (reportQuery.isError) {
    return <QueryErrorState error={reportQuery.error instanceof Error ? reportQuery.error : null} />;
  }

  const totalRows =
    filtered.payments.length + filtered.rentalPayments.length + filtered.attendance.length;
  const countLabel = plural(totalRows, [
    t("common.records.one", { count: totalRows }),
    t("common.records.few", { count: totalRows }),
    t("common.records.many", { count: totalRows }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <History size={18} className="text-gold-700" />
        <h2 className="text-lg font-semibold text-ink-900">{t("corrections.page.title")}</h2>
      </div>
      <p className="text-sm text-ink-500">{t("corrections.page.subtitle")}</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <DatePickerField label={t("corrections.page.dateFrom")} value={dateFrom} onChange={setDateFrom} />
        <DatePickerField label={t("corrections.page.dateTo")} value={dateTo} onChange={setDateTo} />
        <div>
          <label className="text-[10px] text-ink-500 font-sans uppercase tracking-wider font-semibold block mb-1">
            {t("corrections.page.searchPlaceholder")}
          </label>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={searchFieldCls}
              placeholder={t("corrections.page.searchPlaceholder")}
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-ink-500">{countLabel}</p>

      {totalRows === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">
          {t("corrections.page.empty")}
        </div>
      ) : (
        <div className="rounded-xl border border-ink-200 overflow-hidden bg-white">
          {filtered.payments.map((row) => (
            <PaymentCorrectionRow
              key={`p-${row.id}`}
              row={row}
              originalPayment={
                row.reversesPaymentId
                  ? (paymentById.get(row.reversesPaymentId) ?? null)
                  : row.replacesPaymentId
                    ? (paymentById.get(row.replacesPaymentId) ?? null)
                    : null
              }
              t={t}
              formatDateTime={formatDateTime}
            />
          ))}

          {filtered.rentalPayments.map((row) => (
            <PaymentCorrectionRow
              key={`rp-${row.id}`}
              row={row}
              kindLabel={t("corrections.page.kindRentalPayment")}
              originalPayment={
                row.reversesPaymentId
                  ? (paymentById.get(row.reversesPaymentId) ?? null)
                  : row.replacesPaymentId
                    ? (paymentById.get(row.replacesPaymentId) ?? null)
                    : null
              }
              t={t}
              formatDateTime={formatDateTime}
            />
          ))}

          {filtered.attendance.map((row) => (
            <div
              key={`a-${row.id}`}
              className="grid grid-cols-1 sm:grid-cols-[auto_1fr_auto] gap-2 px-4 py-3 border-b border-ink-100 last:border-b-0"
            >
              <div>
                <KindBadge
                  kind={t("corrections.page.kindAttendance")}
                  operationNumber={row.operationNumber}
                  tone="violet"
                />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink-800 truncate">{row.clientDisplay}</p>
                <p className="text-xs text-ink-500 mt-0.5">
                  {formatDate(row.occurrenceDate)} · {row.oldStatus ?? "—"} → {row.newStatus}
                  {row.isUndo ? ` · ${t("corrections.page.undo")}` : ""}
                </p>
                {row.reasonCode && (
                  <p className="text-xs text-ink-500 mt-0.5">
                    {row.reasonCode}
                    {row.reasonComment ? ` — ${row.reasonComment}` : ""}
                  </p>
                )}
                <p className="text-[10px] text-ink-500 mt-1">
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
