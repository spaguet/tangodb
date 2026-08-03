export type RentalDocumentsMode = "off" | "crm" | "export";

export type RentalVatMode = "none" | "included" | "on_top";

export type RentalFiscalStatus =
  | "not_required"
  | "pending"
  | "issued"
  | "failed"
  | "refunded";

export interface RentalBillingProfile {
  documents_mode: RentalDocumentsMode;
  country_code: string;
  legal_name: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legal_address: string;
  bank_name: string;
  bank_bik: string;
  bank_account: string;
  vat_mode: RentalVatMode;
  vat_rate: number;
  invoice_number_prefix: string;
  next_invoice_number: number;
  fiscal_tracking_enabled: boolean;
}

export interface RentalFiscalInput {
  fiscalStatus?: RentalFiscalStatus;
  fiscalReceiptNumber?: string;
  fiscalCashRegisterId?: string;
  fiscalTerminalId?: string;
  fiscalAcquiringId?: string;
}

export interface RentalInvoiceDocumentLine {
  id: string;
  rentalId: string | null;
  lineType: string;
  description: string;
  amount: number;
}

export interface RentalInvoiceDocument {
  invoiceId: string;
  documentNumber: string | null;
  documentVersion: number;
  exportBatchId: string | null;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
  status: string;
  currency: string;
  totalAmount: number;
  netAmount: number | null;
  vatAmount: number | null;
  vatMode: RentalVatMode | null;
  vatRate: number | null;
  issuedAt: string | null;
  issuedBy: string | null;
  paidAmount: number;
  outstanding: number;
  lines: RentalInvoiceDocumentLine[];
  renter: {
    id: string;
    displayName: string | null;
    companyName: string | null;
    inn: string | null;
  };
  organizationName: string;
  billingProfile: RentalBillingProfile;
}

export const DEFAULT_RENTAL_BILLING_PROFILE: RentalBillingProfile = {
  documents_mode: "off",
  country_code: "RU",
  legal_name: "",
  inn: "",
  kpp: "",
  ogrn: "",
  legal_address: "",
  bank_name: "",
  bank_bik: "",
  bank_account: "",
  vat_mode: "none",
  vat_rate: 0,
  invoice_number_prefix: "",
  next_invoice_number: 1,
  fiscal_tracking_enabled: false,
};

export function parseRentalBillingProfile(raw: unknown): RentalBillingProfile {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const mode = String(obj.documents_mode ?? "off");
  const vatMode = String(obj.vat_mode ?? "none");

  return {
    documents_mode:
      mode === "crm" || mode === "export" ? mode : "off",
    country_code: String(obj.country_code ?? "RU"),
    legal_name: String(obj.legal_name ?? ""),
    inn: String(obj.inn ?? ""),
    kpp: String(obj.kpp ?? ""),
    ogrn: String(obj.ogrn ?? ""),
    legal_address: String(obj.legal_address ?? ""),
    bank_name: String(obj.bank_name ?? ""),
    bank_bik: String(obj.bank_bik ?? ""),
    bank_account: String(obj.bank_account ?? ""),
    vat_mode:
      vatMode === "included" || vatMode === "on_top" ? vatMode : "none",
    vat_rate: Number(obj.vat_rate ?? 0),
    invoice_number_prefix: String(obj.invoice_number_prefix ?? ""),
    next_invoice_number: Math.max(1, Number(obj.next_invoice_number ?? 1)),
    fiscal_tracking_enabled: Boolean(obj.fiscal_tracking_enabled),
  };
}

export function computeRentalVat(
  total: number,
  vatMode: RentalVatMode,
  vatRate: number
): { netAmount: number; vatAmount: number } {
  if (total < 0 || vatMode === "none" || vatRate <= 0) {
    return { netAmount: roundMoney(total), vatAmount: 0 };
  }
  if (vatMode === "included") {
    const vatAmount = roundMoney((total * vatRate) / (100 + vatRate));
    return { netAmount: roundMoney(total - vatAmount), vatAmount };
  }
  const netAmount = roundMoney(total);
  return { netAmount, vatAmount: roundMoney((netAmount * vatRate) / 100) };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function defaultFiscalStatusForMethod(
  method: string,
  fiscalTrackingEnabled: boolean
): RentalFiscalStatus {
  if (!fiscalTrackingEnabled) return "not_required";
  if (method === "cash" || method === "card") return "pending";
  return "not_required";
}

export function rentalBillingProfileToPayload(
  profile: RentalBillingProfile
): Record<string, unknown> {
  return {
    documents_mode: profile.documents_mode,
    country_code: profile.country_code.trim(),
    legal_name: profile.legal_name.trim(),
    inn: profile.inn.trim(),
    kpp: profile.kpp.trim(),
    ogrn: profile.ogrn.trim(),
    legal_address: profile.legal_address.trim(),
    bank_name: profile.bank_name.trim(),
    bank_bik: profile.bank_bik.trim(),
    bank_account: profile.bank_account.trim(),
    vat_mode: profile.vat_mode,
    vat_rate: profile.vat_rate,
    invoice_number_prefix: profile.invoice_number_prefix.trim(),
    next_invoice_number: profile.next_invoice_number,
    fiscal_tracking_enabled: profile.fiscal_tracking_enabled,
  };
}

export function mapInvoiceDocument(row: Record<string, unknown>): RentalInvoiceDocument {
  const renter = (row.renter as Record<string, unknown> | null) ?? {};
  const linesRaw = Array.isArray(row.lines) ? row.lines : [];

  return {
    invoiceId: String(row.invoice_id),
    documentNumber: row.document_number != null ? String(row.document_number) : null,
    documentVersion: Number(row.document_version ?? 1),
    exportBatchId: row.export_batch_id != null ? String(row.export_batch_id) : null,
    periodStart: String(row.period_start).slice(0, 10),
    periodEnd: String(row.period_end).slice(0, 10),
    dueDate: String(row.due_date).slice(0, 10),
    status: String(row.status ?? ""),
    currency: String(row.currency ?? "RUB"),
    totalAmount: Number(row.total_amount ?? 0),
    netAmount: row.net_amount != null ? Number(row.net_amount) : null,
    vatAmount: row.vat_amount != null ? Number(row.vat_amount) : null,
    vatMode: (row.vat_mode as RentalVatMode | null) ?? null,
    vatRate: row.vat_rate != null ? Number(row.vat_rate) : null,
    issuedAt: row.issued_at != null ? String(row.issued_at) : null,
    issuedBy: row.issued_by != null ? String(row.issued_by) : null,
    paidAmount: Number(row.paid_amount ?? 0),
    outstanding: Number(row.outstanding ?? 0),
    lines: linesRaw.map((line) => {
      const l = line as Record<string, unknown>;
      return {
        id: String(l.id),
        rentalId: l.rental_id != null ? String(l.rental_id) : null,
        lineType: String(l.line_type ?? ""),
        description: String(l.description ?? ""),
        amount: Number(l.amount ?? 0),
      };
    }),
    renter: {
      id: String(renter.id ?? ""),
      displayName: renter.display_name != null ? String(renter.display_name) : null,
      companyName: renter.company_name != null ? String(renter.company_name) : null,
      inn: renter.inn != null ? String(renter.inn) : null,
    },
    organizationName: String(row.organization_name ?? ""),
    billingProfile: parseRentalBillingProfile(row.billing_profile),
  };
}
