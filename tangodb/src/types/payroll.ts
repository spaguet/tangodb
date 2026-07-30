import type { PaymentMethod } from "../types";

export type PayrollPayMode = "percent" | "fixed" | "fixed_plus_percent";

export interface TeacherPayRate {
  id: string;
  memberId: string;
  payMode: PayrollPayMode;
  fixedAmount: number;
  ratePercent: number;
  groupRatePercent: number;
  personalRatePercent: number;
  singleVisitRatePercent: number;
  effectiveFrom: string;
  createdAt: string;
}

export interface TeacherSettlement {
  id: string;
  memberId: string;
  periodYear: number;
  periodMonth: number;
  amountAccrued: number;
  amountPaid: number;
  computedAt: string;
}

export interface TeacherSettlementPayment {
  id: string;
  settlementId: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export interface SettlementPaymentInput {
  settlementId: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  note?: string;
}

export type SettlementLineCategory = "fixed" | "group" | "personal" | "single_visit" | "adjustment";

export interface TeacherSettlementLineItem {
  id: string;
  lineCategory: SettlementLineCategory;
  sourceType: "rate" | "payment" | "adjustment";
  sourceId: string | null;
  lineDate: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  title: string | null;
  disciplineName: string | null;
  locationName: string | null;
  monetaryBase: number;
  payMode: PayrollPayMode | null;
  fixedRateAmount: number;
  percentRate: number;
  accrualAmount: number;
  includedInTotal: boolean;
  exclusionReason: string | null;
  sortAt: string;
}

export interface TeacherSettlementDetail {
  settlement: TeacherSettlement;
  lines: TeacherSettlementLineItem[];
  excludedLines: TeacherSettlementLineItem[];
  reconciliation: {
    linesTotal: number;
    amountAccrued: number;
    matches: boolean;
    computedAt: string;
  };
}

export interface TeacherPayRateInput {
  memberId: string;
  payMode: PayrollPayMode;
  fixedAmount: number;
  groupRatePercent: number;
  personalRatePercent: number;
  singleVisitRatePercent: number;
  effectiveFrom?: string;
}
