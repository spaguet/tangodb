/**
 * Platform payment config contract (schemaVersion 2).
 * Keep in sync with tangodb/src/lib/platformPaymentContract.ts
 */

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
  const msg = new TextEncoder().encode(value);
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const bitLenHi = Math.floor((msg.length * 8) / 0x100000000);
  const bitLenLo = (msg.length * 8) >>> 0;
  const paddedLen = (((msg.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, bitLenHi);
  view.setUint32(paddedLen - 4, bitLenLo);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4);
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0");
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
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
  return `crypto-${sha256Hex(`${Math.random()}:${Date.now()}`).slice(0, 32)}`;
}
