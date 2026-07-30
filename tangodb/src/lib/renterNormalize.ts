import type { RenterCounterpartyType, RenterStatus } from "../types";

/** Client-side phone normalization (mirrors server normalize_renter_phone). */
export function normalizeRenterPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const stripped = phone.startsWith("+") ? phone.slice(1) : phone;
  const digits = stripped.replace(/[^0-9]/g, "");
  return digits || null;
}

/** Client-side email normalization (mirrors server normalize_renter_email). */
export function normalizeRenterEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed || null;
}

/** Client-side tax id normalization (mirrors server normalize_renter_tax_id). */
export function normalizeRenterTaxId(taxId: string | null | undefined): string | null {
  if (!taxId) return null;
  const normalized = taxId.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return normalized || null;
}

export function renterTypeRequiresLegalFields(type: RenterCounterpartyType): boolean {
  return type === "sole_proprietor" || type === "company";
}

export function isRenterBookable(status: RenterStatus): boolean {
  return status === "active";
}

export function formatRenterStatusBadge(status: RenterStatus): "active" | "archived" | "blocked" {
  return status;
}
