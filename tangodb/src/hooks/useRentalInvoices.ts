import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { PaymentMethod, RentalInvoice, RentalInvoiceStatus, RenterRentalFinanceExtended } from "../types";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { rentersQueryKey } from "./useRenters";

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

function invalidateRenterFinance(queryClient: ReturnType<typeof useQueryClient>, renterId?: string) {
  void queryClient.invalidateQueries({ queryKey: rentalInvoicesQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentersQueryKey, refetchType: "active" });
  if (renterId) {
    void queryClient.invalidateQueries({ queryKey: renterFinanceQueryKey(renterId), refetchType: "active" });
    void queryClient.invalidateQueries({ queryKey: renterInvoicesQueryKey(renterId), refetchType: "active" });
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
      renterId?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_rental_invoice_payment", {
        p_invoice_id: input.invoiceId,
        p_amount: input.amount,
        p_method: input.method,
        p_idempotency_key: input.idempotencyKey,
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
      notes?: string;
    }) => {
      const { data, error } = await supabase.rpc("record_rental_advance", {
        p_payload: {
          renter_id: input.renterId,
          amount: input.amount,
          method: input.method,
          idempotency_key: input.idempotencyKey,
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
      adjustmentAmount: number;
      reason: string;
      renterId?: string;
    }) => {
      const { data, error } = await supabase.rpc("apply_rental_pricing_adjustment", {
        p_rental_id: input.rentalId,
        p_adjustment_amount: input.adjustmentAmount,
        p_reason: input.reason,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; final_amount?: number } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalInvoices.error.adjustmentFailed" };
      }

      return { success: true as const, finalAmount: result.final_amount };
    },
    onSuccess: (_data, variables) => invalidateRenterFinance(queryClient, variables.renterId),
  });
}
