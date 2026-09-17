import type { Client } from "../types";

const DASH_ONLY = /^[\s—–\-]+$/;
const IMPORT_DELETED_STUB_RE = /\(ID\s+\d+\)\s*Удалён/i;
const RELATIONSHIP_LABEL_PREFIX_RE = /^(Партнёр|Сын|Дочь|Муж|Жена|Дочь)\s/i;

const PHONE_PLACEHOLDER_BY_CURRENCY: Record<string, string> = {
  VND: "+84 90 000 0000",
  RUB: "+7 900 000-00-00",
  USD: "+1 555 0100",
  EUR: "+34 600 000 000",
  GBP: "+44 7700 900000",
};

export function formatClientName(lastName: string, firstName: string): string {
  const last = lastName.trim();
  const first = firstName.trim();
  const lastIsPlaceholder = !last || DASH_ONLY.test(last);
  if (lastIsPlaceholder && first) return first;
  if (!last && first) return first;
  if (last && !first) return last;
  return `${last} ${first}`;
}

/** Import/migration ghosts — hide from the active teacher-facing list (U-145). */
export function isImportDeletedStubClient(client: Pick<Client, "firstName" | "lastName">): boolean {
  const combined = `${client.lastName} ${client.firstName}`.trim();
  return IMPORT_DELETED_STUB_RE.test(combined) || IMPORT_DELETED_STUB_RE.test(client.lastName.trim());
}

/** Last name field used as a relationship / note label, not a surname (U-250). */
export function isClientNameRelationshipLabel(client: Pick<Client, "firstName" | "lastName">): boolean {
  const last = client.lastName.trim();
  const first = client.firstName.trim();
  if (!last) return false;
  if (RELATIONSHIP_LABEL_PREFIX_RE.test(last)) return true;
  const words = last.split(/\s+/).filter(Boolean);
  if (words.length >= 2 && first && words.length + first.split(/\s+/).length >= 3) return true;
  return words.length >= 3;
}

export function clientMatchesSearch(client: Pick<Client, "firstName" | "lastName">, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const display = formatClientName(client.lastName, client.firstName).toLowerCase();
  return (
    display.includes(q) ||
    client.firstName.toLowerCase().includes(q) ||
    client.lastName.toLowerCase().includes(q)
  );
}

export function clientPhonePlaceholder(currencyCode: string | undefined | null): string {
  const code = (currencyCode ?? "RUB").trim().toUpperCase();
  return PHONE_PLACEHOLDER_BY_CURRENCY[code] ?? PHONE_PLACEHOLDER_BY_CURRENCY.RUB;
}
