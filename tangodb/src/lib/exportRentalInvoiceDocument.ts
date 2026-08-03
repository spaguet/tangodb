import { buildCsvContent } from "./exportCsv";
import type { RentalInvoiceDocument } from "./rentalBillingProfile";

export function buildRentalInvoiceExportRows(doc: RentalInvoiceDocument) {
  const profile = doc.billingProfile;
  const headerRows = [
    {
      section: "organization",
      field: "legal_name",
      value: profile.legal_name || doc.organizationName,
    },
    { section: "organization", field: "inn", value: profile.inn },
    { section: "organization", field: "kpp", value: profile.kpp },
    { section: "organization", field: "ogrn", value: profile.ogrn },
    { section: "organization", field: "legal_address", value: profile.legal_address },
    { section: "organization", field: "bank_name", value: profile.bank_name },
    { section: "organization", field: "bank_bik", value: profile.bank_bik },
    { section: "organization", field: "bank_account", value: profile.bank_account },
    { section: "document", field: "document_number", value: doc.documentNumber },
    { section: "document", field: "document_version", value: doc.documentVersion },
    { section: "document", field: "period_start", value: doc.periodStart },
    { section: "document", field: "period_end", value: doc.periodEnd },
    { section: "document", field: "due_date", value: doc.dueDate },
    { section: "document", field: "currency", value: doc.currency },
    { section: "document", field: "total_amount", value: doc.totalAmount },
    { section: "document", field: "net_amount", value: doc.netAmount },
    { section: "document", field: "vat_amount", value: doc.vatAmount },
    { section: "document", field: "vat_mode", value: doc.vatMode },
    { section: "document", field: "vat_rate", value: doc.vatRate },
    { section: "renter", field: "display_name", value: doc.renter.displayName },
    { section: "renter", field: "company_name", value: doc.renter.companyName },
    { section: "renter", field: "inn", value: doc.renter.inn },
  ];

  const lineRows = doc.lines.map((line, index) => ({
    section: "line",
    field: String(index + 1),
    line_type: line.lineType,
    description: line.description,
    rental_id: line.rentalId,
    amount: line.amount,
  }));

  return [...headerRows, ...lineRows];
}

export function buildRentalInvoiceExportCsv(doc: RentalInvoiceDocument): string {
  const rows = buildRentalInvoiceExportRows(doc);
  return buildCsvContent(
    rows.map((row) => {
      const base: Record<string, string | number | null> = {
        section: "section" in row ? String(row.section) : "",
        field: "field" in row ? String(row.field) : "",
      };
      for (const [key, value] of Object.entries(row)) {
        if (key === "section" || key === "field") continue;
        base[key] = value == null ? "" : typeof value === "number" ? value : String(value);
      }
      return base;
    })
  );
}

export function rentalInvoiceExportFilename(doc: RentalInvoiceDocument): string {
  const number = doc.documentNumber?.replace(/[^\w.-]+/g, "_") || doc.invoiceId.slice(0, 8);
  return `rental-invoice_${number}_v${doc.documentVersion}.csv`;
}
