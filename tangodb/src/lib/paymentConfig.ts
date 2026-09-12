import {
  parsePlatformPaymentConfig,
  type CrmPrice,
  type PaymentQuoteResult,
  type PlatformPaymentSku,
} from "./platformPaymentContract.ts";

export type { CrmPrice, PaymentQuoteResult, PlatformPaymentSku };

export interface CryptoPaymentMethod {
  id?: string;
  coin: string;
  network: string;
  address: string;
  uriTemplate?: string;
  amount?: string;
  currency?: string;
  monthlyAmount?: string;
  monthlyCurrency?: string;
  qrImageUrl?: string;
}

export interface BankTransferConfig {
  beneficiary: string;
  bankName?: string;
  ibanOrAccount: string;
  swiftOrBic?: string;
  cardLast4?: string;
  note: string;
  amount?: string;
  currency?: string;
  monthlyAmount?: string;
  monthlyCurrency?: string;
  qrImageUrl?: string;
}

export interface MirPaymentConfig {
  recipient: string;
  phoneOrCard: string;
  bankName?: string;
  note: string;
  amount?: string;
  currency?: string;
  monthlyAmount?: string;
  monthlyCurrency?: string;
  qrImageUrl?: string;
}

export interface VietnameseBankTransferConfig {
  beneficiary: string;
  bankName?: string;
  accountNumber: string;
  note: string;
  amount?: string;
  currency?: string;
  monthlyAmount?: string;
  monthlyCurrency?: string;
  qrImageUrl?: string;
}

export interface DeveloperContactsConfig {
  email: string;
  telegramUrl: string;
  whatsappUrl: string;
}

export interface RenterMiniappAddonPrice {
  amount: string;
  currency: string;
}

export interface ManualPaymentConfig {
  schemaVersion?: number;
  pricingRevision?: number;
  crmLifetime?: CrmPrice | null;
  crmMonthly?: CrmPrice | null;
  crypto?: CryptoPaymentMethod[];
  bankTransfer?: BankTransferConfig | null;
  vietnameseBankTransfer?: VietnameseBankTransferConfig | null;
  mir?: MirPaymentConfig | null;
  contacts?: DeveloperContactsConfig | null;
  renterMiniappAddon?: RenterMiniappAddonPrice | null;
}

const EMPTY_CONFIG: ManualPaymentConfig = {};

export function parseManualPaymentConfig(raw: unknown): ManualPaymentConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_CONFIG;
  const parsed = parsePlatformPaymentConfig(raw);
  const value = raw as Record<string, unknown>;

  const crypto = parsed.crypto?.map((row) => ({
    id: row.id,
    coin: row.coin,
    network: row.network,
    address: row.address,
    uriTemplate: row.uriTemplate,
    amount: row.amount,
    currency: row.currency,
    monthlyAmount: row.monthlyAmount,
    monthlyCurrency: row.monthlyCurrency,
    qrImageUrl: row.qrImageUrl,
  }));

  const bankTransfer =
    value.bankTransfer && typeof value.bankTransfer === "object" && !Array.isArray(value.bankTransfer)
      ? normalizeBankTransfer(value.bankTransfer as Record<string, unknown>)
      : null;

  const mir =
    value.mir && typeof value.mir === "object" && !Array.isArray(value.mir)
      ? normalizeMir(value.mir as Record<string, unknown>)
      : null;

  const vietnameseBankTransfer =
    value.vietnameseBankTransfer &&
    typeof value.vietnameseBankTransfer === "object" &&
    !Array.isArray(value.vietnameseBankTransfer)
      ? normalizeVietnameseBankTransfer(value.vietnameseBankTransfer as Record<string, unknown>)
      : null;

  const contacts =
    value.contacts && typeof value.contacts === "object" && !Array.isArray(value.contacts)
      ? normalizeContacts(value.contacts as Record<string, unknown>)
      : null;

  const renterMiniappAddon =
    value.renterMiniappAddon &&
    typeof value.renterMiniappAddon === "object" &&
    !Array.isArray(value.renterMiniappAddon)
      ? normalizeAddonPrice(value.renterMiniappAddon as Record<string, unknown>)
      : null;

  return {
    schemaVersion: parsed.schemaVersion,
    pricingRevision: parsed.pricingRevision,
    crmLifetime: parsed.crmLifetime,
    crmMonthly: parsed.crmMonthly,
    crypto: crypto?.length ? crypto : undefined,
    bankTransfer: bankTransfer?.beneficiary || bankTransfer?.ibanOrAccount ? bankTransfer : null,
    vietnameseBankTransfer:
      vietnameseBankTransfer?.beneficiary || vietnameseBankTransfer?.accountNumber
        ? vietnameseBankTransfer
        : null,
    mir: mir?.recipient || mir?.phoneOrCard ? mir : null,
    contacts,
    renterMiniappAddon,
  };
}

function normalizeBankTransfer(row: Record<string, unknown>): BankTransferConfig {
  return {
    beneficiary: String(row.beneficiary ?? "").trim(),
    bankName: row.bankName ? String(row.bankName).trim() : undefined,
    ibanOrAccount: String(row.ibanOrAccount ?? "").trim(),
    swiftOrBic: row.swiftOrBic ? String(row.swiftOrBic).trim() : undefined,
    cardLast4: row.cardLast4 ? String(row.cardLast4).trim() : undefined,
    note: String(row.note ?? "").trim(),
    amount: row.amount ? String(row.amount).trim() : undefined,
    currency: row.currency ? String(row.currency).trim() : undefined,
    monthlyAmount: row.monthlyAmount ? String(row.monthlyAmount).trim() : undefined,
    monthlyCurrency: row.monthlyCurrency ? String(row.monthlyCurrency).trim() : undefined,
    qrImageUrl: row.qrImageUrl ? String(row.qrImageUrl).trim() : undefined,
  };
}

function normalizeMir(row: Record<string, unknown>): MirPaymentConfig {
  return {
    recipient: String(row.recipient ?? "").trim(),
    phoneOrCard: String(row.phoneOrCard ?? "").trim(),
    bankName: row.bankName ? String(row.bankName).trim() : undefined,
    note: String(row.note ?? "").trim(),
    amount: row.amount ? String(row.amount).trim() : undefined,
    currency: row.currency ? String(row.currency).trim() : undefined,
    monthlyAmount: row.monthlyAmount ? String(row.monthlyAmount).trim() : undefined,
    monthlyCurrency: row.monthlyCurrency ? String(row.monthlyCurrency).trim() : undefined,
    qrImageUrl: row.qrImageUrl ? String(row.qrImageUrl).trim() : undefined,
  };
}

function normalizeVietnameseBankTransfer(row: Record<string, unknown>): VietnameseBankTransferConfig {
  return {
    beneficiary: String(row.beneficiary ?? "").trim(),
    bankName: row.bankName ? String(row.bankName).trim() : undefined,
    accountNumber: String(row.accountNumber ?? "").trim(),
    note: String(row.note ?? "").trim(),
    amount: row.amount ? String(row.amount).trim() : undefined,
    currency: row.currency ? String(row.currency).trim() : undefined,
    monthlyAmount: row.monthlyAmount ? String(row.monthlyAmount).trim() : undefined,
    monthlyCurrency: row.monthlyCurrency ? String(row.monthlyCurrency).trim() : undefined,
    qrImageUrl: row.qrImageUrl ? String(row.qrImageUrl).trim() : undefined,
  };
}

function normalizeContacts(row: Record<string, unknown>): DeveloperContactsConfig {
  return {
    email: String(row.email ?? "").trim(),
    telegramUrl: String(row.telegramUrl ?? "").trim(),
    whatsappUrl: String(row.whatsappUrl ?? "").trim(),
  };
}

function normalizeAddonPrice(row: Record<string, unknown>): RenterMiniappAddonPrice | null {
  const amount = String(row.amount ?? "").trim();
  const currency = String(row.currency ?? "").trim();
  if (!amount) return null;
  return { amount, currency };
}

/** Show platform QR/accounts on the Mini App page without leaking CRM lifetime amounts. */
export function overlayPaymentAmounts(
  config: ManualPaymentConfig,
  amount?: string | null,
  currency?: string | null
): ManualPaymentConfig {
  const nextAmount = amount?.trim() || undefined;
  const nextCurrency = currency?.trim() || undefined;
  const patch = <T extends { amount?: string; currency?: string }>(row: T): T => ({
    ...row,
    amount: nextAmount,
    currency: nextCurrency,
  });

  return {
    ...config,
    crypto: config.crypto?.map((row) => patch(row)),
    bankTransfer: config.bankTransfer ? patch(config.bankTransfer) : null,
    vietnameseBankTransfer: config.vietnameseBankTransfer
      ? patch(config.vietnameseBankTransfer)
      : null,
    mir: config.mir ? patch(config.mir) : null,
  };
}

export function hasManualPaymentContent(config: ManualPaymentConfig): boolean {
  return !!(
    config.crypto?.length ||
    config.bankTransfer?.beneficiary ||
    config.bankTransfer?.ibanOrAccount ||
    config.vietnameseBankTransfer?.beneficiary ||
    config.vietnameseBankTransfer?.accountNumber ||
    config.mir?.recipient ||
    config.mir?.phoneOrCard ||
    config.contacts?.email ||
    config.contacts?.telegramUrl ||
    config.contacts?.whatsappUrl
  );
}

export function buildCryptoQrValue(method: CryptoPaymentMethod): string {
  if (method.uriTemplate) return method.uriTemplate;
  const address = method.address.trim();
  const coin = method.coin.toUpperCase();
  if (coin === "BTC") return `bitcoin:${address}`;
  if (coin === "ETH" || coin.startsWith("USDT_ERC")) return `ethereum:${address}`;
  if (coin === "TON") return `ton://transfer/${address}`;
  return address;
}

export function isSafeMailto(email: string): string | null {
  const trimmed = email.trim();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return `mailto:${trimmed}`;
}

export function isSafeTelegramUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://t.me/")) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.hostname !== "t.me") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

export function isSafeWhatsappUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://wa.me/")) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" || parsed.hostname !== "wa.me") return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

import type { I18nKey } from "./i18n/keys";

type TranslateFn = (key: I18nKey) => string;

export function getPurchaseActivationSteps(t: TranslateFn, sku?: PlatformPaymentSku | ""): string[] {
  const monthly = sku === "crm_subscription";
  return [
    t("license.purchase.step1"),
    t("license.purchase.step2"),
    t("license.purchase.step3"),
    t("license.purchase.step4"),
    t(monthly ? "license.purchase.step5Monthly" : "license.purchase.step5"),
    t(monthly ? "license.purchase.step6Monthly" : "license.purchase.step6"),
  ];
}
