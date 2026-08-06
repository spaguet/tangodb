import { formatDateTimeLocale, t } from "./i18n";
import type { PaymentMethod } from "../types";

export interface CsvExportLabels {
  clientsActive: Record<string, string>;
  clientsArchive: Record<string, string>;
  subscriptions: Record<string, string>;
  attendance: Record<string, string>;
  personalLessons: Record<string, string>;
  payments: Record<string, string>;
  expenses: Record<string, string>;
  debtors: Record<string, string>;
  subscriptionActive: string;
  subscriptionFinished: string;
  attendanceStatus: (status: string) => string;
  yes: string;
  no: string;
  clientNotSpecified: string;
  debtorKindSubscription: string;
  debtorKindPersonal: string;
  paymentMethod: (method: PaymentMethod) => string;
  paymentSourceSubscription: string;
  paymentSourcePersonal: string;
  paymentSourceSingleVisit: string;
  skipClients: string;
  skipSubscriptions: string;
  skipAttendance: (month: string) => string;
  skipPersonal: (month: string) => string;
  skipPayments: string;
  skipExpenses: string;
  skipDebtors: string;
  formatDateTime: (iso: string) => string;
  formatDate: (isoDate: string) => string;
}

export function getCsvExportLabels(locale?: string | null): CsvExportLabels {
  const col = (key: Parameters<typeof t>[1]) => t(locale, key);

  return {
    clientsActive: {
      id: col("csv.column.id"),
      lastName: col("csv.column.lastName"),
      firstName: col("csv.column.firstName"),
      telegram: col("csv.column.telegram"),
      createdAt: col("csv.column.createdAt"),
    },
    clientsArchive: {
      id: col("csv.column.id"),
      lastName: col("csv.column.lastName"),
      firstName: col("csv.column.firstName"),
      telegram: col("csv.column.telegram"),
      archivedAt: col("csv.column.archivedAt"),
    },
    subscriptions: {
      id: col("csv.column.id"),
      type: col("csv.column.type"),
      client1: col("csv.column.client1"),
      client2: col("csv.column.client2"),
      client3: col("csv.column.client3"),
      lessonsLeft: col("csv.column.lessonsLeft"),
      status: col("csv.column.status"),
      activationDate: col("csv.column.activationDate"),
    },
    attendance: {
      date: col("csv.column.date"),
      subscriptionId: col("csv.column.subscriptionId"),
      clientDisplay: col("csv.column.clients"),
      status: col("csv.column.status"),
    },
    personalLessons: {
      date: col("csv.column.date"),
      time: col("csv.column.time"),
      clients: col("csv.column.clients"),
      paid: col("csv.column.paid"),
      price: col("csv.column.price"),
    },
    payments: {
      client: col("csv.column.client"),
      date: col("csv.column.date"),
      source: col("csv.column.source"),
      method: col("csv.column.method"),
      amount: col("csv.column.amount"),
    },
    expenses: {
      date: col("csv.column.date"),
      category: col("csv.column.category"),
      payee: col("csv.column.payee"),
      description: col("csv.column.description"),
      amount: col("csv.column.amount"),
    },
    debtors: {
      client: col("csv.column.client"),
      contact: col("csv.column.contact"),
      kind: col("csv.column.kind"),
      detail: col("csv.column.detail"),
      amount: col("csv.column.debtAmount"),
    },
    subscriptionActive: col("csv.value.subscriptionActive"),
    subscriptionFinished: col("csv.value.subscriptionFinished"),
    attendanceStatus: (status: string) => {
      const map: Record<string, Parameters<typeof t>[1]> = {
        present: "csv.value.attendance.present",
        absent: "csv.value.attendance.absent",
        freeze: "csv.value.attendance.freeze",
        excused: "csv.value.attendance.excused",
      };
      const key = map[status];
      return key ? t(locale, key) : status;
    },
    yes: col("csv.value.yes"),
    no: col("csv.value.no"),
    clientNotSpecified: col("csv.value.clientNotSpecified"),
    debtorKindSubscription: col("csv.value.debtorKind.subscription"),
    debtorKindPersonal: col("csv.value.debtorKind.personal"),
    paymentMethod: (method: PaymentMethod) => {
      const map: Record<PaymentMethod, Parameters<typeof t>[1]> = {
        cash: "common.payment.cash",
        transfer: "common.payment.transfer",
        card: "common.payment.card",
        other: "common.payment.other",
      };
      return t(locale, map[method]);
    },
    paymentSourceSubscription: col("common.payment.source.subscription"),
    paymentSourcePersonal: col("common.payment.source.personalLesson"),
    paymentSourceSingleVisit: col("common.payment.source.singleVisit"),
    skipClients: col("csv.skip.clients"),
    skipSubscriptions: col("csv.skip.subscriptions"),
    skipAttendance: (month: string) => t(locale, "csv.skip.attendance", { month }),
    skipPersonal: (month: string) => t(locale, "csv.skip.personal", { month }),
    skipPayments: col("csv.skip.payments"),
    skipExpenses: col("csv.skip.expenses"),
    skipDebtors: col("csv.skip.debtors"),
    formatDateTime: (iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return iso;
      return formatDateTimeLocale(d, locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    },
    formatDate: (isoDate: string) => {
      const d = new Date(`${isoDate}T12:00:00`);
      if (Number.isNaN(d.getTime())) return isoDate;
      return formatDateTimeLocale(d, locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    },
  };
}
