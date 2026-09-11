export const v1ConfigFixture = {
  bankTransfer: {
    beneficiary: "Studio",
    ibanOrAccount: "DE123",
    note: "email",
    amount: "150",
    currency: "USD",
  },
};

export const v2ConfigFixture = {
  schemaVersion: 2,
  pricingRevision: 3,
  crmLifetime: { amount: "199", currency: "USD" },
  crmMonthly: { amount: "29", currency: "USD" },
  bankTransfer: {
    methodCode: "bankTransfer",
    beneficiary: "Studio",
    ibanOrAccount: "DE123",
    note: "email",
    amount: "199",
    currency: "USD",
    monthlyAmount: "29",
    monthlyCurrency: "USD",
  },
  vietnameseBankTransfer: {
    methodCode: "vietnameseBankTransfer",
    beneficiary: "VN Studio",
    accountNumber: "123",
    note: "email",
    amount: "5000000",
    currency: "VND",
    monthlyAmount: "750000",
    monthlyCurrency: "VND",
  },
  crypto: [
    {
      id: "a1111111-1111-4111-8111-111111111111",
      coin: "USDT",
      network: "TRC20",
      address: "TAddr",
      amount: "199",
      currency: "USDT",
      monthlyAmount: "29",
      monthlyCurrency: "USDT",
    },
  ],
};
