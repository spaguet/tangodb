export interface CryptoPaymentMethod {
  coin: string;
  network: string;
  address: string;
  uriTemplate: string;
}

export interface BankTransferConfig {
  beneficiary: string;
  bankName: string;
  ibanOrAccount: string;
  swiftOrBic: string;
  cardLast4: string;
  note: string;
}

export interface MirPaymentConfig {
  recipient: string;
  phoneOrCard: string;
  bankName: string;
  note: string;
}

export interface DeveloperContactsConfig {
  email: string;
  telegramUrl: string;
  whatsappUrl: string;
}

export interface PaymentConfigFormState {
  crypto: CryptoPaymentMethod[];
  bankTransfer: BankTransferConfig;
  mir: MirPaymentConfig;
  contacts: DeveloperContactsConfig;
}

export type ManualPaymentConfigPayload = {
  crypto?: Array<{
    coin: string;
    network: string;
    address: string;
    uriTemplate?: string;
  }>;
  bankTransfer?: Partial<BankTransferConfig> | null;
  mir?: Partial<MirPaymentConfig> | null;
  contacts?: Partial<DeveloperContactsConfig> | null;
};

export const emptyCryptoRow = (): CryptoPaymentMethod => ({
  coin: "",
  network: "",
  address: "",
  uriTemplate: "",
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
  },
  mir: {
    recipient: "",
    phoneOrCard: "",
    bankName: "",
    note: "",
  },
  contacts: {
    email: "",
    telegramUrl: "",
    whatsappUrl: "",
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
    }))
    .filter((row) => row.coin && row.address);

  const bankTransfer = {
    beneficiary: trim(form.bankTransfer.beneficiary),
    bankName: trim(form.bankTransfer.bankName) || undefined,
    ibanOrAccount: trim(form.bankTransfer.ibanOrAccount),
    swiftOrBic: trim(form.bankTransfer.swiftOrBic) || undefined,
    cardLast4: trim(form.bankTransfer.cardLast4) || undefined,
    note: trim(form.bankTransfer.note),
  };

  const mir = {
    recipient: trim(form.mir.recipient),
    phoneOrCard: trim(form.mir.phoneOrCard),
    bankName: trim(form.mir.bankName) || undefined,
    note: trim(form.mir.note),
  };

  const contacts = {
    email: trim(form.contacts.email),
    telegramUrl: trim(form.contacts.telegramUrl),
    whatsappUrl: trim(form.contacts.whatsappUrl),
  };

  const payload: ManualPaymentConfigPayload = {};

  if (crypto.length) payload.crypto = crypto;
  if (bankTransfer.beneficiary || bankTransfer.ibanOrAccount) payload.bankTransfer = bankTransfer;
  if (mir.recipient || mir.phoneOrCard) payload.mir = mir;
  if (contacts.email || contacts.telegramUrl || contacts.whatsappUrl) payload.contacts = contacts;

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
    };
  }

  if (value.mir && typeof value.mir === "object" && !Array.isArray(value.mir)) {
    const mir = value.mir as Record<string, unknown>;
    form.mir = {
      recipient: String(mir.recipient ?? ""),
      phoneOrCard: String(mir.phoneOrCard ?? ""),
      bankName: String(mir.bankName ?? ""),
      note: String(mir.note ?? ""),
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

  return form;
}
