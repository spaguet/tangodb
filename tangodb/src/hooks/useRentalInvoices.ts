import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type {
  PaymentMethod,
  RentalAccrualReport,
  RentalAdvance,
  RentalAdvanceAllocation,
  RentalInvoice,
  RentalInvoiceStatus,
  RenterRentalFinanceExtended,
} from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { rentersQueryKey } from "./useRenters";
import { rentalMoneyRegisterQueryKey } from "./useRentalMoneyRegister";

export const rentalInvoicesQueryKey = ["rental-invoices"] as const;

function mapInvoice(row: Record<string, unknown>): RentalInvoice {
  return {
    id: String(row.id),
    seriesId: row.series_id != null ? String(row.series_id) : null,
    periodStart: String(row.period_start).slice(0, 10),
    periodEnd: String(row.period_end).slice(0, 10),
    dueDate: String(row.due_date).slice(0, 10),
    status: (row.status as RentalInvoiceStatus) ?? "draft",
    currency: String(row.currency ?? "RUB"),
    totalAmount: Number(row.total_amount ?? 0),
    paidAmount: Number(row.paid_amount ?? 0),
    outstanding: Number(row.outstanding ?? 0),
  };
}

function mapFinance(row: Record<string, unknown>): RenterRentalFinanceExtended {
  return {
    invoiceDebt: Number(row.invoice_debt ?? 0),
    uninvoicedRentalDebt: Number(row.uninvoiced_rental_debt ?? 0),
    totalDebt: Number(row.total_debt ?? 0),
    advanceBalance: Number(row.advance_balance ?? 0),
    depositBalance: Number(row.deposit_balance ?? 0),
    overdueAmount: Number(row.overdue_amount ?? 0),
  };
}

function renterFinanceQueryKey(renterId: string) {
  return [...rentalInvoicesQueryKey, "renter-finance", renterId] as const;
}

function renterInvoicesQueryKey(renterId: string) {
  return [...rentalInvoicesQueryKey, "renter-invoices", renterId] as const;
}

function renterAdvancesQueryKey(renterId: string) {
  return [...rentalInvoicesQueryKey, "renter-advances", renterId] as const;
}

function renterAllocationsQueryKey(renterId: string) {
  return [...rentalInvoicesQueryKey, "renter-allocations", renterId] as const;
}

function accrualReportQueryKey(periodStart: string, periodEnd: string, renterId?: string | null) {
  return [...rentalInvoicesQueryKey, "accrual-report", periodStart, periodEnd, renterId ?? "all"] as const;
}

function mapAdvance(row: Record<string, unknown>): RentalAdvance {
  return {
    id: String(row.id),
    amount: Number(row.amount ?? 0),
    allocatedAmount: Number(row.allocated_amount ?? 0),
    available: Number(row.available ?? 0),
    currency: String(row.currency ?? "RUB"),
    method: (row.method as PaymentMethod) ?? "cash",
    operationDate: String(row.operation_date).slice(0, 10),
    receivedAt: String(row.created_at ?? ""),
    notes: row.notes != null ? String(row.notes) : null,
  };
}

function mapAllocation(row: Record<string, unknown>): RentalAdvanceAllocation {
  return {
    id: String(row.id),
    advanceId: String(row.advance_id),
    invoiceId: String(row.invoice_id),
    invoicePeriodStart: String(row.invoice_period_start).slice(0, 10),
    invoicePeriodEnd: String(row.invoice_period_end).slice(0, 10),
    amount: Number(row.amount ?? 0),
    allocatedAt: String(row.allocated_at ?? ""),
    cancelledAt: row.cancelled_at != null ? String(row.cancelled_at) : null,
    allocatedBy: row.allocated_by != null ? String(row.allocated_by) : null,
  };
}

function mapAccrualReport(row: Record<string, unknown>): RentalAccrualReport {
  return {
    periodStart: String(row.period_start).slice(0, 10),
    periodEnd: String(row.period_end).slice(0, 10),
    renterId: row.renter_id != null ? String(row.renter_id) : null,
    accruedAmount: Number(row.accrued_amount ?? 0),
    paidDirect: Number(row.paid_direct ?? 0),
    paidInvoice: Number(row.paid_invoice ?? 0),
    paidTotal: Number(row.paid_total ?? 0),
    advancesReceived: Number(row.advances_received ?? 0),
    advancesAllocated: Number(row.advances_allocated ?? 0),
    invoiceDebt: Number(row.invoice_debt ?? 0),
    uninvoicedDebt: Number(row.uninvoiced_debt ?? 0),
    totalDebt: Number(row.total_debt ?? 0),
  };
}

function invalidateRenterFinance(queryClient: ReturnType<typeof useQueryClient>, renterId?: string) {
  void queryClient.invalidateQueries({ queryKey: rentalInvoicesQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentalMoneyRegisterQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentersQueryKey, refetchType: "active" });
  if (renterId) {
    void queryClient.invalidateQueries({ queryKey: renterFinanceQueryKey(renterId), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: renterInvoicesQueryKey(renterId), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: renterAdvancesQueryKey(renterId), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: renterAllocationsQueryKey(renterId), refetchType: "active" });
  }
}

export function useRenterRentalInvoices(renterId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(renterInvoicesQueryKey(renterId ?? "")),
    enabled: orgEnabled && enabled && !!renterId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renter_rental_invoices", {
        p_renter_id: renterId!,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string; invoices?: unknown[] } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "rentalInvoices.error.loadFailed");
      }

      return (result.invoices ?? []).map((row) => mapInvoice(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useRenterRentalAdvances(renterId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(renterAdvancesQueryKey(renterId ?? "")),
    enabled: orgEnabled && enabled && !!renterId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renter_rental_advances", {
        p_renter_id: renterId!,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string; advances?: unknown[] } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "rentalInvoices.error.advancesLoadFailed");
      }

      return (result.advances ?? []).map((row) => mapAdvance(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useRenterRentalAdvanceAllocations(renterId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(renterAllocationsQueryKey(renterId ?? "")),
    enabled: orgEnabled && enabled && !!renterId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renter_rental_advance_allocations", {
        p_renter_id: renterId!,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string; allocations?: unknown[] } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "rentalInvoices.error.allocationsLoadFailed");
      }

      return (result.allocations ?? []).map((row) => mapAllocation(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useRentalAccrualReport(
  periodStart: string,
  periodEnd: string,
  renterId?: string | null,
  enabled = true
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(accrualReportQueryKey(periodStart, periodEnd, renterId)),
    enabled: orgEnabled && enabled && !!periodStart && !!periodEnd,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_accrual_report", {
        p_period_start: periodStart,
        p_period_end: periodEnd,
        p_renter_id: renterId ?? null,
      });

      if (error) throw error;

      const result = data as {
        success?: boolean;
        error?: string;
        report?: Record<string, unknown>;
      } | null;

      if (!result?.success || !result.report) {
        throw new Error(result?.error ?? "rentalAccrual.error.loadFailed");
      }

      return mapAccrualReport(result.report);
    },
    staleTime: 30 * 1000,
  });
}

export function useRenterRentalFinance(renterId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(renterFinanceQueryKey(renterId ?? "")),
    enabled: orgEnabled && enabled && !!renterId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_renter_rental_finance", {
        p_renter_id: renterId!,
      });

      if (error) throw error;

      const result = data as {
        success?: boolean;
        error?: string;
        finance?: Record<string, unknown>;
      } | null;

      if (!result?.success || !result.finance) {
        throw new Error(result?.error ?? "rentalInvoices.error.financeLoadFailed");
      }

      return mapFinance(result.finance);
    },
    staleTime: 30 * 1000,
  });
}

export interface CreateRentalInvoiceInput {
  idempotencyKey: string;
  renterId: string;
  periodStart: string;
  periodEnd: string;
  seriesId?: string | null;
  dueDate?: string;
  status?: RentalInvoiceStatus;
}

export function useCreateRentalInvoice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateRentalInvoiceInput) => {
      const { data, error } = await supabase.rpc("create_rental_invoice", {
        p_payload: {
          idempotency_key: input.idempotencyKey,
          renter_id: input.renterId,
          series_id: input.seriesId ?? null,
          period_start: input.periodStart,
          period_end: input.periodEnd,
          due_date: input.dueDate ?? null,
          status: input.status ?? "invoiced",
        },
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        invoice_id?: string;
        total_amount?: number;
        already_applied?: boolean;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalInvoices.error.createFailed" };
      }

      return {
        success: true as const,
        invoiceId: result.invoice_id ?? "",
        totalAmount: result.total_amount,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (_data, variables) => invalidateRenterFinance(queryClient, variables.renterId),
  });
}

export function useRecordRentalInvoicePayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      invoiceId: string;
      amount: number;
      method: PaymentMethod;
      idempotencyKey: string;
      operationDate?: string;
      renterId?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_rental_invoice_payment", {
        p_invoice_id: input.invoiceId,
        p_amount: input.amount,
        p_method: input.method,
        p_idempotency_key: input.idempotencyKey,
        p_operation_date: input.operationDate ?? null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        payment_id?: string;
        paid_amount?: number;
        status?: RentalInvoiceStatus;
        already_applied?: boolean;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalInvoices.error.paymentFailed" };
      }

      return {
        success: true as const,
        paymentId: result.payment_id ?? "",
        paidAmount: result.paid_amount,
        status: result.status,
        alreadyApplied: result.already_applied ?? false,
      };
    },
    onSuccess: (_data, variables) => invalidateRenterFinance(queryClient, variables.renterId),
  });
}

export function useRecordRentalAdvance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      amount: number;
      method: PaymentMethod;
      idempotencyKey: string;
      operationDate?: string;
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_rental_advance", {
        p_payload: {
          renter_id: input.renterId,
          amount: input.amount,
          method: input.method,
          idempotency_key: input.idempotencyKey,
          operation_date: input.operationDate ?? null,
          notes: input.notes ?? null,
        },
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; advance_id?: string; already_applied?: boolean } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalInvoices.error.advanceFailed" };
      }

      return { success: true as const, advanceId: result.advance_id ?? "", alreadyApplied: result.already_applied ?? false };
    },
    onSuccess: (_data, variables) => invalidateRenterFinance(queryClient, variables.renterId),
  });
}

export function useAllocateRentalAdvance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      advanceId: string;
      invoiceId: string;
      amount: number;
      renterId?: string;
    }) => {
      const { data, error } = await supabase.rpc("allocate_rental_advance", {
        p_advance_id: input.advanceId,
        p_invoice_id: input.invoiceId,
        p_amount: input.amount,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalInvoices.error.allocateFailed" };
      }

      return { success: true as const };
    },
    onSuccess: (_data, variables) => invalidateRenterFinance(queryClient, variables.renterId),
  });
}

export function useCancelRentalAdvanceAllocation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { allocationId: string; renterId?: string }) => {
      const { data, error } = await supabase.rpc("cancel_rental_advance_allocation", {
        p_allocation_id: input.allocationId,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalInvoices.error.cancelAllocationFailed" };
      }

      return { success: true as const };
    },
    onSuccess: (_data, variables) => invalidateRenterFinance(queryClient, variables.renterId),
  });
}

export function useRecordRentalDepositMovement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      amount: number;
      movementType: "deposit" | "refund" | "forfeit";
      contractId?: string | null;
      notes?: string;
      idempotencyKey: string;
    }) => {
      const { data, error } = await supabase.rpc("record_rental_deposit_movement", {
        p_payload: {
          renter_id: input.renterId,
          amount: input.amount,
          movement_type: input.movementType,
          contract_id: input.contractId ?? null,
          notes: input.notes ?? null,
          idempotency_key: input.idempotencyKey,
        },
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; deposit_id?: string; already_applied?: boolean } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalInvoices.error.depositFailed" };
      }

      return { success: true as const, depositId: result.deposit_id ?? "", alreadyApplied: result.already_applied ?? false };
    },
    onSuccess: (_data, variables) => invalidateRenterFinance(queryClient, variables.renterId),
  });
}

export function useApplyRentalPricingAdjustment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      rentalId: string;
      newAmount: number;
      reason: string;
      renterId?: string;
    }) => {
      const { data, error } = await supabase.rpc("apply_rental_pricing_adjustment", {
        p_rental_id: input.rentalId,
        p_new_amount: input.newAmount,
        p_reason: input.reason,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        new_amount?: number;
        remaining?: number;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "schedule.rental.amountAdjustFailed" };
      }

      return {
        success: true as const,
        newAmount: result.new_amount,
        remaining: result.remaining,
      };
    },
    onSuccess: (_data, variables) => invalidateRenterFinance(queryClient, variables.renterId),
  });
}
