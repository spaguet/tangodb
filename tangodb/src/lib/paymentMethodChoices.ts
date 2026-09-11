import type { ManualPaymentConfig } from "./paymentConfig";
import { FIXED_PAYMENT_METHOD_CODES } from "./platformPaymentContract";

export interface PaymentMethodChoice {
  methodCode: string;
  label: string;
}

function bankConfigured(row: { ibanOrAccount?: string; accountNumber?: string } | null | undefined): boolean {
  if (!row) return false;
  const iban = String(row.ibanOrAccount ?? "").trim();
  const account = String((row as { accountNumber?: string }).accountNumber ?? "").trim();
  return Boolean(iban || account);
}

/** Selectable payment rails for lifetime quote (crm_license) until S3b monthly SKU UI. */
export function listPaymentMethodChoices(config: ManualPaymentConfig): PaymentMethodChoice[] {
  const choices: PaymentMethodChoice[] = [];

  if (bankConfigured(config.bankTransfer)) {
    choices.push({ methodCode: FIXED_PAYMENT_METHOD_CODES.bankTransfer, label: "bankTransfer" });
  }
  if (bankConfigured(config.vietnameseBankTransfer)) {
    choices.push({
      methodCode: FIXED_PAYMENT_METHOD_CODES.vietnameseBankTransfer,
      label: "vietnameseBankTransfer",
    });
  }
  if (config.mir && String(config.mir.phoneOrCard ?? "").trim()) {
    choices.push({ methodCode: FIXED_PAYMENT_METHOD_CODES.mir, label: "mir" });
  }
  for (const row of config.crypto ?? []) {
    const id = String(row.id ?? "").trim();
    if (!id) continue;
    const coin = String(row.coin ?? "Crypto").trim();
    choices.push({ methodCode: id, label: `crypto:${coin}` });
  }

  return choices;
}
