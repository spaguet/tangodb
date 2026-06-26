import type { PaymentMethod } from "../types";

export interface TeacherPayRate {
  id: string;
  memberId: string;
  ratePercent: number;
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
  createdAt: string;
}

export interface SettlementPaymentInput {
  settlementId: string;
  amount: number;
  paidAt: string;
  method: PaymentMethod;
  note?: string;
}

export interface TeacherPayRateInput {
  memberId: string;
  ratePercent: number;
  effectiveFrom?: string;
}
