/**
 * Platform payment config contract (schemaVersion 2).
 * Keep tangodb/supabase/functions/_shared/platformPaymentContract.ts in sync.
 */

import { createHash } from "node:crypto";

export const PLATFORM_PAYMENT_SCHEMA_VERSION = 2;

export const FIXED_PAYMENT_METHOD_CODES = {
  bankTransfer: "bankTransfer",
  vietnameseBankTransfer: "vietnameseBankTransfer",
  mir: "mir",
} as const;

export type FixedPaymentMethodCode =
  (typeof FIXED_PAYMENT_METHOD_CODES)[keyof typeof FIXED_PAYMENT_METHOD_CODES];

export type PlatformPaymentSku = "crm_license" | "crm_subscription";

export type CrmPrice = {
  amount: string;
  currency: string;
};

export type CryptoMethodRow = {
  id?: string;
  methodCode?: string;
  coin: string;
  network: string;
  address: string;
  uriTemplate?: string;
  amount?: string;
  currency?: string;
  monthlyAmount?: string;
  monthlyCurrency?: string;
  qrImageUrl?: string;
};

export type BankMethodRow = {
  methodCode?: string;
  beneficiary: string;
  bankName?: string;
  ibanOrAccount?: string;
  accountNumber?: string;
  swiftOrBic?: string;
  cardLast4?: string;
  recipient?: string;
  phoneOrCard?: string;
  note: string;
  amount?: string;
  currency?: string;
  monthlyAmount?: string;
  monthlyCurrency?: string;
  qrImageUrl?: string;
};

export type PlatformPaymentConfigV2 = {
  schemaVersion: number;
  pricingRevision: number;
  crmLifetime?: CrmPrice | null;
  crmMonthly?: CrmPrice | null;
  crypto?: CryptoMethodRow[];
  bankTransfer?: BankMethodRow | null;
  vietnameseBankTransfer?: BankMethodRow | null;
  mir?: BankMethodRow | null;
  contacts?: Record<string, unknown> | null;
  renterMiniappAddon?: Record<string, unknown> | null;
};

export type ParsedPlatformPaymentConfig = PlatformPaymentConfigV2;

export type PaymentQuoteSuccess = {
  ok: true;
  sku: PlatformPaymentSku;
  methodCode: string;
  amount: string;
  currency: string;
  paymentDetails: string;
  qrSha256: string | null;
  pricingRevision: number;
};

export type PaymentQuoteFailure = {
  ok: false;
  code:
    | "invalid_config"
    | "invalid_sku"
    | "unknown_method"
    | "invalid_amount"
    | "invalid_currency"
    | "monthly_not_configured"
    | "crypto_missing_id";
};

export type PaymentQuoteResult = PaymentQuoteSuccess | PaymentQuoteFailure;

const CURRENCY_ALLOWLIST = new Set([
  "USD",
  "EUR",
  "GBP",
  "RUB",
  "VND",
  "USDT",
  "USDC",
  "BTC",
  "ETH",
  "TON",
]);

function trim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parsePrice(raw: unknown): CrmPrice | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const amount = trim(row.amount);
  const currency = normalizeCurrency(trim(row.currency));
  if (!amount || !currency) return null;
  if (!isPositiveDecimal(amount)) return null;
  return { amount, currency };
}

function isPositiveDecimal(value: string): boolean {
  if (!/^\d+(\.\d+)?$/.test(value)) return false;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}

export function normalizeCurrency(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  if (!code) return null;
  if (!CURRENCY_ALLOWLIST.has(code)) return null;
  return code;
}

export function readSchemaVersion(raw: Record<string, unknown>): number {
  const version = raw.schemaVersion;
  if (version === undefined || version === null) return 1;
  const n = Number(version);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

export function readPricingRevision(raw: Record<string, unknown>): number {
  const n = Number(raw.pricingRevision ?? 1);
  if (!Number.isInteger(n) || n < 1) return 1;
  return n;
}

function normalizeCryptoRow(row: Record<string, unknown>): CryptoMethodRow | null {
  const coin = trim(row.coin);
  const address = trim(row.address);
  if (!coin || !address) return null;
  const id = trim(row.id) || undefined;
  const methodCode = trim(row.methodCode) || id || undefined;
  return {
    id,
    methodCode,
    coin,
    network: trim(row.network),
    address,
    uriTemplate: trim(row.uriTemplate) || undefined,
    amount: trim(row.amount) || undefined,
    currency: trim(row.currency) || undefined,
    monthlyAmount: trim(row.monthlyAmount) || undefined,
    monthlyCurrency: trim(row.monthlyCurrency) || undefined,
    qrImageUrl: trim(row.qrImageUrl) || undefined,
  };
}

function normalizeBankRow(
  row: Record<string, unknown>,
  defaultMethodCode: FixedPaymentMethodCode,
  ibanKey: "ibanOrAccount" | "accountNumber" = "ibanOrAccount"
): BankMethodRow | null {
  const beneficiary = trim(row.beneficiary) || trim(row.recipient);
  const account = trim(row[ibanKey]) || trim(row.phoneOrCard);
  if (!beneficiary && !account) return null;
  const methodCode = trim(row.methodCode) || defaultMethodCode;
  return {
    methodCode,
    beneficiary: trim(row.beneficiary),
    recipient: trim(row.recipient),
    bankName: trim(row.bankName) || undefined,
    ibanOrAccount: ibanKey === "ibanOrAccount" ? trim(row.ibanOrAccount) || undefined : undefined,
    accountNumber: ibanKey === "accountNumber" ? trim(row.accountNumber) || undefined : undefined,
    phoneOrCard: trim(row.phoneOrCard) || undefined,
    swiftOrBic: trim(row.swiftOrBic) || undefined,
    cardLast4: trim(row.cardLast4) || undefined,
    note: trim(row.note),
    amount: trim(row.amount) || undefined,
    currency: trim(row.currency) || undefined,
    monthlyAmount: trim(row.monthlyAmount) || undefined,
    monthlyCurrency: trim(row.monthlyCurrency) || undefined,
    qrImageUrl: trim(row.qrImageUrl) || undefined,
  };
}

/** Parse raw JSON from platform_payment_methods.config (v1 + v2). */
export function parsePlatformPaymentConfig(raw: unknown): ParsedPlatformPaymentConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { schemaVersion: 1, pricingRevision: 1 };
  }
  const value = raw as Record<string, unknown>;
  const schemaVersion = readSchemaVersion(value);
  const pricingRevision = readPricingRevision(value);

  const crypto = Array.isArray(value.crypto)
    ? value.crypto
        .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
        .map((row) => normalizeCryptoRow(row))
        .filter((row): row is CryptoMethodRow => row !== null)
    : undefined;

  const bankTransfer =
    value.bankTransfer && typeof value.bankTransfer === "object" && !Array.isArray(value.bankTransfer)
      ? normalizeBankRow(
          value.bankTransfer as Record<string, unknown>,
          FIXED_PAYMENT_METHOD_CODES.bankTransfer,
          "ibanOrAccount"
        )
      : null;

  const vietnameseBankTransfer =
    value.vietnameseBankTransfer &&
    typeof value.vietnameseBankTransfer === "object" &&
    !Array.isArray(value.vietnameseBankTransfer)
      ? normalizeBankRow(
          value.vietnameseBankTransfer as Record<string, unknown>,
          FIXED_PAYMENT_METHOD_CODES.vietnameseBankTransfer,
          "accountNumber"
        )
      : null;

  const mir =
    value.mir && typeof value.mir === "object" && !Array.isArray(value.mir)
      ? normalizeBankRow(value.mir as Record<string, unknown>, FIXED_PAYMENT_METHOD_CODES.mir, "ibanOrAccount")
      : null;

  return {
    schemaVersion,
    pricingRevision,
    crmLifetime: parsePrice(value.crmLifetime),
    crmMonthly: parsePrice(value.crmMonthly),
    crypto: crypto?.length ? crypto : undefined,
    bankTransfer,
    vietnameseBankTransfer,
    mir,
    contacts:
      value.contacts && typeof value.contacts === "object" && !Array.isArray(value.contacts)
        ? (value.contacts as Record<string, unknown>)
        : null,
    renterMiniappAddon:
      value.renterMiniappAddon &&
      typeof value.renterMiniappAddon === "object" &&
      !Array.isArray(value.renterMiniappAddon)
        ? (value.renterMiniappAddon as Record<string, unknown>)
        : null,
  };
}

function resolveSkuPrice(
  config: ParsedPlatformPaymentConfig,
  sku: PlatformPaymentSku,
  methodLifetimeAmount?: string,
  methodLifetimeCurrency?: string,
  methodMonthlyAmount?: string,
  methodMonthlyCurrency?: string
): { amount: string; currency: string } | null {
  const isLifetime = sku === "crm_license";
  const canonical = isLifetime ? config.crmLifetime : config.crmMonthly;
  const overrideAmount = isLifetime ? methodLifetimeAmount : methodMonthlyAmount;
  const overrideCurrency = isLifetime ? methodLifetimeCurrency : methodMonthlyCurrency;

  if (config.schemaVersion >= PLATFORM_PAYMENT_SCHEMA_VERSION) {
    if (!canonical) {
      if (sku === "crm_subscription") return null;
    }
    const amount = trim(overrideAmount) || canonical?.amount || "";
    const currency =
      normalizeCurrency(trim(overrideCurrency) || canonical?.currency || "") ??
      normalizeCurrency(canonical?.currency || "");
    if (!amount || !currency) return null;
    if (!isPositiveDecimal(amount)) return null;
    return { amount, currency };
  }

  if (sku === "crm_subscription") return null;

  const amount = trim(overrideAmount) || "";
  const currency = normalizeCurrency(trim(overrideCurrency) || "");
  if (!amount || !currency) return null;
  if (!isPositiveDecimal(amount)) return null;
  return { amount, currency };
}

function findMethodByCode(
  config: ParsedPlatformPaymentConfig,
  methodCode: string
): { kind: "crypto"; row: CryptoMethodRow } | { kind: "bank"; row: BankMethodRow } | null {
  const code = methodCode.trim();
  if (!code) return null;

  if (code === FIXED_PAYMENT_METHOD_CODES.bankTransfer && config.bankTransfer) {
    return { kind: "bank", row: config.bankTransfer };
  }
  if (code === FIXED_PAYMENT_METHOD_CODES.vietnameseBankTransfer && config.vietnameseBankTransfer) {
    return { kind: "bank", row: config.vietnameseBankTransfer };
  }
  if (code === FIXED_PAYMENT_METHOD_CODES.mir && config.mir) {
    return { kind: "bank", row: config.mir };
  }

  const crypto = config.crypto?.find((row) => row.id === code || row.methodCode === code);
  if (crypto) {
    return { kind: "crypto", row: crypto };
  }
  return null;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function paymentDetailsFromMethod(
  match: { kind: "crypto"; row: CryptoMethodRow } | { kind: "bank"; row: BankMethodRow }
): string {
  const lines: string[] = [];
  if (match.kind === "crypto") {
    const row = match.row;
    lines.push(`Coin: ${row.coin}`);
    if (row.network) lines.push(`Network: ${row.network}`);
    lines.push(`Address: ${row.address}`);
    if (row.uriTemplate) lines.push(`URI: ${row.uriTemplate}`);
  } else {
    const row = match.row;
    if (row.beneficiary) lines.push(`Beneficiary: ${row.beneficiary}`);
    if (row.recipient) lines.push(`Recipient: ${row.recipient}`);
    if (row.bankName) lines.push(`Bank: ${row.bankName}`);
    if (row.ibanOrAccount) lines.push(`Account/IBAN: ${row.ibanOrAccount}`);
    if (row.accountNumber) lines.push(`Account: ${row.accountNumber}`);
    if (row.phoneOrCard) lines.push(`Phone/Card: ${row.phoneOrCard}`);
    if (row.swiftOrBic) lines.push(`SWIFT/BIC: ${row.swiftOrBic}`);
    if (row.note) lines.push(`Note: ${row.note}`);
  }
  return lines.join("\n").trim();
}

function qrSha256FromMethod(
  match: { kind: "crypto"; row: CryptoMethodRow } | { kind: "bank"; row: BankMethodRow }
): string | null {
  const qr = trim(match.row.qrImageUrl);
  if (!qr || !qr.startsWith("data:image")) return null;
  return sha256Hex(qr);
}

export function resolvePaymentQuote(
  rawConfig: unknown,
  sku: PlatformPaymentSku,
  methodCode: string
): PaymentQuoteResult {
  if (sku !== "crm_license" && sku !== "crm_subscription") {
    return { ok: false, code: "invalid_sku" };
  }

  const config = parsePlatformPaymentConfig(rawConfig);
  const match = findMethodByCode(config, methodCode);
  if (!match) return { ok: false, code: "unknown_method" };
  if (match.kind === "crypto" && !match.row.id) {
    return { ok: false, code: "crypto_missing_id" };
  }

  const price = resolveSkuPrice(
    config,
    sku,
    match.row.amount,
    match.row.currency,
    match.row.monthlyAmount,
    match.row.monthlyCurrency
  );

  if (!price) {
    if (sku === "crm_subscription") return { ok: false, code: "monthly_not_configured" };
    return { ok: false, code: "invalid_amount" };
  }

  const currency = normalizeCurrency(price.currency);
  if (!currency) return { ok: false, code: "invalid_currency" };

  const paymentDetails = paymentDetailsFromMethod(match);
  if (!paymentDetails) return { ok: false, code: "invalid_config" };

  const resolvedMethodCode =
    match.kind === "crypto" ? (match.row.id as string) : trim(match.row.methodCode) || methodCode;

  return {
    ok: true,
    sku,
    methodCode: resolvedMethodCode,
    amount: price.amount,
    currency,
    paymentDetails,
    qrSha256: qrSha256FromMethod(match),
    pricingRevision: config.pricingRevision,
  };
}

function firstLifetimeFallback(config: ParsedPlatformPaymentConfig): CrmPrice | null {
  const candidates: Array<{ amount?: string; currency?: string }> = [
    ...(config.crypto ?? []),
    config.bankTransfer ?? {},
    config.vietnameseBankTransfer ?? {},
    config.mir ?? {},
  ];
  for (const row of candidates) {
    const amount = trim(row.amount);
    const currency = normalizeCurrency(trim(row.currency));
    if (amount && currency && isPositiveDecimal(amount)) {
      return { amount, currency };
    }
  }
  return null;
}

export function pricingFingerprint(config: ParsedPlatformPaymentConfig): string {
  const slice = {
    crmLifetime: config.crmLifetime,
    crmMonthly: config.crmMonthly,
    crypto: config.crypto?.map((row) => ({
      id: row.id,
      amount: row.amount,
      currency: row.currency,
      monthlyAmount: row.monthlyAmount,
      monthlyCurrency: row.monthlyCurrency,
    })),
    bankTransfer: pickPricingFields(config.bankTransfer),
    vietnameseBankTransfer: pickPricingFields(config.vietnameseBankTransfer),
    mir: pickPricingFields(config.mir),
  };
  return sha256Hex(JSON.stringify(slice));
}

function pickPricingFields(row: BankMethodRow | null | undefined) {
  if (!row) return null;
  return {
    amount: row.amount,
    currency: row.currency,
    monthlyAmount: row.monthlyAmount,
    monthlyCurrency: row.monthlyCurrency,
  };
}

export type PrepareSaveResult =
  | { ok: true; config: Record<string, unknown>; pricingRevision: number; pricingChanged: boolean }
  | { ok: false; code: "revision_conflict" };

/** Backfill v2 fields, stable crypto ids, and pricingRevision compare-and-swap. */
export function preparePaymentConfigForSave(
  incoming: unknown,
  existing: unknown,
  expectedPricingRevision: number | null | undefined
): PrepareSaveResult {
  const parsedIncoming = parsePlatformPaymentConfig(incoming);
  const parsedExisting = parsePlatformPaymentConfig(existing);

  if (
    expectedPricingRevision != null &&
    Number.isInteger(expectedPricingRevision) &&
    expectedPricingRevision !== parsedExisting.pricingRevision
  ) {
    return { ok: false, code: "revision_conflict" };
  }

  const base =
    incoming && typeof incoming === "object" && !Array.isArray(incoming)
      ? { ...(incoming as Record<string, unknown>) }
      : {};

  const schemaVersion = Math.max(parsedIncoming.schemaVersion, PLATFORM_PAYMENT_SCHEMA_VERSION);
  let crmLifetime = parsedIncoming.crmLifetime ?? parsedExisting.crmLifetime;
  if (!crmLifetime) {
    crmLifetime = firstLifetimeFallback(parsedIncoming) ?? firstLifetimeFallback(parsedExisting);
  }

  const crmMonthly = parsedIncoming.crmMonthly ?? parsedExisting.crmMonthly ?? null;

  const crypto = Array.isArray(base.crypto)
    ? (base.crypto as Record<string, unknown>[]).map((row) => {
        const normalized = normalizeCryptoRow(row);
        if (!normalized) return row;
        const id = normalized.id || cryptoRandomId();
        return {
          ...row,
          id,
          methodCode: id,
        };
      })
    : base.crypto;

  const withMeta: Record<string, unknown> = {
    ...base,
    schemaVersion,
    crypto,
    crmLifetime: crmLifetime ?? undefined,
    crmMonthly: crmMonthly ?? undefined,
  };

  if (withMeta.bankTransfer && typeof withMeta.bankTransfer === "object") {
    const bank = withMeta.bankTransfer as Record<string, unknown>;
    if (!trim(bank.methodCode)) bank.methodCode = FIXED_PAYMENT_METHOD_CODES.bankTransfer;
  }
  if (withMeta.vietnameseBankTransfer && typeof withMeta.vietnameseBankTransfer === "object") {
    const bank = withMeta.vietnameseBankTransfer as Record<string, unknown>;
    if (!trim(bank.methodCode)) bank.methodCode = FIXED_PAYMENT_METHOD_CODES.vietnameseBankTransfer;
  }
  if (withMeta.mir && typeof withMeta.mir === "object") {
    const bank = withMeta.mir as Record<string, unknown>;
    if (!trim(bank.methodCode)) bank.methodCode = FIXED_PAYMENT_METHOD_CODES.mir;
  }

  const nextParsed = parsePlatformPaymentConfig(withMeta);
  const pricingChanged = pricingFingerprint(nextParsed) !== pricingFingerprint(parsedExisting);
  const pricingRevision = pricingChanged
    ? parsedExisting.pricingRevision + 1
    : parsedExisting.pricingRevision || 1;

  withMeta.pricingRevision = pricingRevision;

  return { ok: true, config: withMeta, pricingRevision, pricingChanged };
}

function cryptoRandomId(): string {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `crypto-${createHash("sha256").update(String(Math.random())).digest("hex").slice(0, 32)}`;
}
