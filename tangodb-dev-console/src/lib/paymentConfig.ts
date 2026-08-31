export interface CryptoPaymentMethod {
  coin: string;
  network: string;
  address: string;
  uriTemplate: string;
  amount: string;
  currency: string;
  qrImageUrl: string;
}

export interface BankTransferConfig {
  beneficiary: string;
  bankName: string;
  ibanOrAccount: string;
  swiftOrBic: string;
  cardLast4: string;
  note: string;
  amount: string;
  currency: string;
  qrImageUrl: string;
}

export interface MirPaymentConfig {
  recipient: string;
  phoneOrCard: string;
  bankName: string;
  note: string;
  amount: string;
  currency: string;
  qrImageUrl: string;
}

export interface VietnameseBankTransferConfig {
  beneficiary: string;
  bankName: string;
  accountNumber: string;
  note: string;
  amount: string;
  currency: string;
  qrImageUrl: string;
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

export interface PaymentConfigFormState {
  crypto: CryptoPaymentMethod[];
  bankTransfer: BankTransferConfig;
  vietnameseBankTransfer: VietnameseBankTransferConfig;
  mir: MirPaymentConfig;
  contacts: DeveloperContactsConfig;
  renterMiniappAddon: RenterMiniappAddonPrice;
}

export type ManualPaymentConfigPayload = {
  crypto?: Array<{
    coin: string;
    network: string;
    address: string;
    uriTemplate?: string;
    amount?: string;
    currency?: string;
    qrImageUrl?: string;
  }>;
  bankTransfer?: Partial<BankTransferConfig> | null;
  vietnameseBankTransfer?: Partial<VietnameseBankTransferConfig> | null;
  mir?: Partial<MirPaymentConfig> | null;
  contacts?: Partial<DeveloperContactsConfig> | null;
  renterMiniappAddon?: Partial<RenterMiniappAddonPrice> | null;
};

export const emptyCryptoRow = (): CryptoPaymentMethod => ({
  coin: "",
  network: "",
  address: "",
  uriTemplate: "",
  amount: "",
  currency: "",
  qrImageUrl: "",
});

export const emptyPaymentConfigForm = (): PaymentConfigFormState => ({
  crypto: [emptyCryptoRow()],
  bankTransfer: {
    beneficiary: "",
    bankName: "",
    ibanOrAccount: "",
    swiftOrBic: "",
    cardLast4: "",
    note: "",
    amount: "",
    currency: "",
    qrImageUrl: "",
  },
  vietnameseBankTransfer: {
    beneficiary: "",
    bankName: "",
    accountNumber: "",
    note: "",
    amount: "",
    currency: "",
    qrImageUrl: "",
  },
  mir: {
    recipient: "",
    phoneOrCard: "",
    bankName: "",
    note: "",
    amount: "",
    currency: "",
    qrImageUrl: "",
  },
  contacts: {
    email: "",
    telegramUrl: "",
    whatsappUrl: "",
  },
  renterMiniappAddon: {
    amount: "",
    currency: "",
  },
});

function trim(value: string | undefined): string {
  return (value ?? "").trim();
}

export function formStateToConfig(form: PaymentConfigFormState): ManualPaymentConfigPayload {
  const crypto = form.crypto
    .map((row) => ({
      coin: trim(row.coin),
      network: trim(row.network),
      address: trim(row.address),
      uriTemplate: trim(row.uriTemplate) || undefined,
      amount: trim(row.amount) || undefined,
      currency: trim(row.currency) || undefined,
      qrImageUrl: trim(row.qrImageUrl) || undefined,
    }))
    .filter((row) => row.coin && row.address);

  const bankTransfer = {
    beneficiary: trim(form.bankTransfer.beneficiary),
    bankName: trim(form.bankTransfer.bankName) || undefined,
    ibanOrAccount: trim(form.bankTransfer.ibanOrAccount),
    swiftOrBic: trim(form.bankTransfer.swiftOrBic) || undefined,
    cardLast4: trim(form.bankTransfer.cardLast4) || undefined,
    note: trim(form.bankTransfer.note),
    amount: trim(form.bankTransfer.amount) || undefined,
    currency: trim(form.bankTransfer.currency) || undefined,
    qrImageUrl: trim(form.bankTransfer.qrImageUrl) || undefined,
  };

  const vietnameseBankTransfer = {
    beneficiary: trim(form.vietnameseBankTransfer.beneficiary),
    bankName: trim(form.vietnameseBankTransfer.bankName) || undefined,
    accountNumber: trim(form.vietnameseBankTransfer.accountNumber),
    note: trim(form.vietnameseBankTransfer.note),
    amount: trim(form.vietnameseBankTransfer.amount) || undefined,
    currency: trim(form.vietnameseBankTransfer.currency) || undefined,
    qrImageUrl: trim(form.vietnameseBankTransfer.qrImageUrl) || undefined,
  };

  const mir = {
    recipient: trim(form.mir.recipient),
    phoneOrCard: trim(form.mir.phoneOrCard),
    bankName: trim(form.mir.bankName) || undefined,
    note: trim(form.mir.note),
    amount: trim(form.mir.amount) || undefined,
    currency: trim(form.mir.currency) || undefined,
    qrImageUrl: trim(form.mir.qrImageUrl) || undefined,
  };

  const contacts = {
    email: trim(form.contacts.email),
    telegramUrl: trim(form.contacts.telegramUrl),
    whatsappUrl: trim(form.contacts.whatsappUrl),
  };

  const addonAmount = trim(form.renterMiniappAddon.amount);
  const addonCurrency = trim(form.renterMiniappAddon.currency);

  const payload: ManualPaymentConfigPayload = {};

  if (crypto.length) payload.crypto = crypto;
  if (bankTransfer.beneficiary || bankTransfer.ibanOrAccount) payload.bankTransfer = bankTransfer;
  if (vietnameseBankTransfer.beneficiary || vietnameseBankTransfer.accountNumber) {
    payload.vietnameseBankTransfer = vietnameseBankTransfer;
  }
  if (mir.recipient || mir.phoneOrCard) payload.mir = mir;
  if (contacts.email || contacts.telegramUrl || contacts.whatsappUrl) payload.contacts = contacts;
  if (addonAmount) {
    payload.renterMiniappAddon = {
      amount: addonAmount,
      currency: addonCurrency || undefined,
    };
  }

  return payload;
}

export function configToFormState(raw: unknown): PaymentConfigFormState {
  const form = emptyPaymentConfigForm();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return form;

  const value = raw as Record<string, unknown>;

  if (Array.isArray(value.crypto) && value.crypto.length > 0) {
    form.crypto = value.crypto
      .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
      .map((row) => ({
        coin: String(row.coin ?? ""),
        network: String(row.network ?? ""),
        address: String(row.address ?? ""),
        uriTemplate: String(row.uriTemplate ?? ""),
        amount: String(row.amount ?? ""),
        currency: String(row.currency ?? ""),
        qrImageUrl: String(row.qrImageUrl ?? ""),
      }));
  }

  if (value.bankTransfer && typeof value.bankTransfer === "object" && !Array.isArray(value.bankTransfer)) {
    const bank = value.bankTransfer as Record<string, unknown>;
    form.bankTransfer = {
      beneficiary: String(bank.beneficiary ?? ""),
      bankName: String(bank.bankName ?? ""),
      ibanOrAccount: String(bank.ibanOrAccount ?? ""),
      swiftOrBic: String(bank.swiftOrBic ?? ""),
      cardLast4: String(bank.cardLast4 ?? ""),
      note: String(bank.note ?? ""),
      amount: String(bank.amount ?? ""),
      currency: String(bank.currency ?? ""),
      qrImageUrl: String(bank.qrImageUrl ?? ""),
    };
  }

  if (
    value.vietnameseBankTransfer &&
    typeof value.vietnameseBankTransfer === "object" &&
    !Array.isArray(value.vietnameseBankTransfer)
  ) {
    const bank = value.vietnameseBankTransfer as Record<string, unknown>;
    form.vietnameseBankTransfer = {
      beneficiary: String(bank.beneficiary ?? ""),
      bankName: String(bank.bankName ?? ""),
      accountNumber: String(bank.accountNumber ?? ""),
      note: String(bank.note ?? ""),
      amount: String(bank.amount ?? ""),
      currency: String(bank.currency ?? ""),
      qrImageUrl: String(bank.qrImageUrl ?? ""),
    };
  }

  if (value.mir && typeof value.mir === "object" && !Array.isArray(value.mir)) {
    const mir = value.mir as Record<string, unknown>;
    form.mir = {
      recipient: String(mir.recipient ?? ""),
      phoneOrCard: String(mir.phoneOrCard ?? ""),
      bankName: String(mir.bankName ?? ""),
      note: String(mir.note ?? ""),
      amount: String(mir.amount ?? ""),
      currency: String(mir.currency ?? ""),
      qrImageUrl: String(mir.qrImageUrl ?? ""),
    };
  }

  if (value.contacts && typeof value.contacts === "object" && !Array.isArray(value.contacts)) {
    const contacts = value.contacts as Record<string, unknown>;
    form.contacts = {
      email: String(contacts.email ?? ""),
      telegramUrl: String(contacts.telegramUrl ?? ""),
      whatsappUrl: String(contacts.whatsappUrl ?? ""),
    };
  }

  if (
    value.renterMiniappAddon &&
    typeof value.renterMiniappAddon === "object" &&
    !Array.isArray(value.renterMiniappAddon)
  ) {
    const addon = value.renterMiniappAddon as Record<string, unknown>;
    form.renterMiniappAddon = {
      amount: String(addon.amount ?? ""),
      currency: String(addon.currency ?? ""),
    };
  }

  return form;
}
