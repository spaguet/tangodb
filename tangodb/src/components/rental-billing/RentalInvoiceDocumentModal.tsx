import { AnimatePresence, motion } from "motion/react";
import { Download, FileText, X } from "lucide-react";
import { useI18n } from "../../hooks/useI18n";
import { useRentalInvoiceDocument } from "../../hooks/useRentalBillingProfile";
import { buildRentalInvoiceExportCsv, rentalInvoiceExportFilename } from "../../lib/exportRentalInvoiceDocument";
import { formatCurrency } from "../../lib/utils";
import LoadingState from "../ui/LoadingState";
import { btnAddCls, btnCancelCls } from "../ui/buttonStyles";

export default function RentalInvoiceDocumentModal({
  open,
  invoiceId,
  onClose,
}: {
  open: boolean;
  invoiceId: string | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const docQuery = useRentalInvoiceDocument(open ? invoiceId : null);
  const doc = docQuery.data;

  const handleDownload = () => {
    if (!doc) return;
    const content = buildRentalInvoiceExportCsv(doc);
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = rentalInvoiceExportFilename(doc);
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {open && invoiceId ? (
        <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-slate-900/40"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-2xl max-h-[85vh] overflow-hidden bg-white rounded-xl border border-slate-200 shadow-xl flex flex-col"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-indigo-600 shrink-0" />
                <h3 className="text-base font-semibold text-slate-900 truncate">
                  {t("rentalBilling.documentTitle")}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg cursor-pointer"
                aria-label={t("common.close")}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4 text-sm">
              {docQuery.isLoading ? (
                <LoadingState label={t("common.loading.default")} />
              ) : docQuery.isError || !doc ? (
                <p className="text-sm text-rose-600">{t("rentalBilling.error.documentLoadFailed")}</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <p>
                      <span className="text-slate-400">{t("rentalBilling.documentNumber")}:</span>{" "}
                      {doc.documentNumber ?? "—"}
                    </p>
                    <p>
                      <span className="text-slate-400">{t("rentalBilling.documentVersion")}:</span>{" "}
                      {doc.documentVersion}
                    </p>
                    <p>
                      <span className="text-slate-400">{t("rentalInvoices.period")}:</span>{" "}
                      {doc.periodStart} – {doc.periodEnd}
                    </p>
                    <p>
                      <span className="text-slate-400">{t("rentalInvoices.dueDate")}:</span> {doc.dueDate}
                    </p>
                  </div>

                  <div className="rounded-lg bg-slate-50 p-3 text-xs space-y-1">
                    <p className="font-semibold text-slate-800">{doc.organizationName}</p>
                    {doc.billingProfile.legal_name ? <p>{doc.billingProfile.legal_name}</p> : null}
                    {doc.billingProfile.inn ? (
                      <p>
                        {t("rentalBilling.inn")}: {doc.billingProfile.inn}
                      </p>
                    ) : null}
                    {doc.billingProfile.legal_address ? <p>{doc.billingProfile.legal_address}</p> : null}
                  </div>

                  <div className="text-xs">
                    <p className="font-semibold text-slate-800">{t("rentalBilling.renter")}</p>
                    <p>{doc.renter.displayName ?? "—"}</p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-left text-slate-400 uppercase tracking-wider">
                          <th className="py-1 pr-2">{t("rentalBilling.lineDescription")}</th>
                          <th className="py-1 text-right">{t("rentalInvoices.total")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {doc.lines.map((line) => (
                          <tr key={line.id} className="border-b border-slate-50">
                            <td className="py-2 pr-2">{line.description}</td>
                            <td className="py-2 text-right">{formatCurrency(line.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs justify-end">
                    {doc.netAmount != null ? (
                      <span>
                        {t("rentalBilling.netAmount")}: {formatCurrency(doc.netAmount)}
                      </span>
                    ) : null}
                    {doc.vatAmount != null && doc.vatAmount > 0 ? (
                      <span>
                        {t("rentalBilling.vatAmount")}: {formatCurrency(doc.vatAmount)}
                      </span>
                    ) : null}
                    <span className="font-semibold text-slate-900">
                      {t("rentalInvoices.total")}: {formatCurrency(doc.totalAmount)} {doc.currency}
                    </span>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
              <button type="button" onClick={onClose} className={btnCancelCls}>
                {t("common.close")}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!doc}
                className={`${btnAddCls} inline-flex items-center gap-1.5`}
              >
                <Download className="w-3.5 h-3.5" />
                {t("rentalBilling.exportCsv")}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
