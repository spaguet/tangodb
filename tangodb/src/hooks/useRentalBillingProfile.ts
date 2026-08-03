import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import {
  mapInvoiceDocument,
  parseRentalBillingProfile,
  rentalBillingProfileToPayload,
  type RentalBillingProfile,
  type RentalFiscalInput,
} from "../lib/rentalBillingProfile";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { rentalInvoicesQueryKey } from "./useRentalInvoices";

export const rentalBillingProfileQueryKey = ["rental-billing-profile"] as const;

export function useRentalBillingProfile() {
  const { organizationId, enabled } = useOrgQueryScope();

  return useQuery({
    queryKey: [...rentalBillingProfileQueryKey, organizationId],
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_billing_profile");
      if (error) throw error;

      const result = data as { success?: boolean; error?: string; profile?: unknown } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "rentalBilling.error.loadFailed");
      }

      return parseRentalBillingProfile(result.profile);
    },
    staleTime: 60 * 1000,
  });
}

export function useUpdateRentalBillingProfile() {
  const queryClient = useQueryClient();
  const { organizationId } = useOrgQueryScope();

  return useMutation({
    mutationFn: async (profile: RentalBillingProfile) => {
      const { data, error } = await supabase.rpc("update_rental_billing_profile", {
        p_payload: rentalBillingProfileToPayload(profile),
      });
      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; profile?: unknown } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalBilling.error.saveFailed" };
      }

      return {
        success: true as const,
        profile: parseRentalBillingProfile(result.profile),
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.setQueryData(
          [...rentalBillingProfileQueryKey, organizationId],
          result.profile
        );
        void queryClient.invalidateQueries({ queryKey: ["organization-context"] });
      }
    },
  });
}

export function useIssueRentalInvoiceDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { invoiceId: string; renterId?: string }) => {
      const { data, error } = await supabase.rpc("issue_rental_invoice_document", {
        p_invoice_id: input.invoiceId,
      });
      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        document_number?: string;
        document_version?: number;
        reissued?: boolean;
      } | null;

      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "rentalBilling.error.issueFailed" };
      }

      return {
        success: true as const,
        documentNumber: result.document_number ?? null,
        documentVersion: result.document_version ?? 1,
        reissued: result.reissued ?? false,
      };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: rentalInvoicesQueryKey, refetchType: "active" });
      if (variables.renterId) {
        void queryClient.invalidateQueries({
          queryKey: [...rentalInvoicesQueryKey, "renter-invoices", variables.renterId],
          refetchType: "active",
        });
      }
    },
  });
}

export function useRentalInvoiceDocument(invoiceId: string | null) {
  const { enabled } = useOrgQueryScope();

  return useQuery({
    queryKey: [...rentalInvoicesQueryKey, "document", invoiceId],
    enabled: enabled && !!invoiceId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_rental_invoice_document", {
        p_invoice_id: invoiceId,
      });
      if (error) throw error;

      const result = data as { success?: boolean; error?: string; document?: Record<string, unknown> } | null;
      if (!result?.success || !result.document) {
        throw new Error(result?.error ?? "rentalBilling.error.documentLoadFailed");
      }

      return mapInvoiceDocument(result.document);
    },
  });
}

export function useExportRentalInvoiceDocuments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { invoiceIds: string[]; renterId?: string }) => {
      const { data, error } = await supabase.rpc("export_rental_invoice_documents", {
        p_invoice_ids: input.invoiceIds,
      });
      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        export_batch_id?: string;
        documents?: Record<string, unknown>[];
      } | null;

      if (!result?.success || !result.documents) {
        return { success: false as const, error: result?.error ?? "rentalBilling.error.exportFailed" };
      }

      return {
        success: true as const,
        exportBatchId: result.export_batch_id ?? "",
        documents: result.documents.map(mapInvoiceDocument),
      };
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: rentalInvoicesQueryKey, refetchType: "active" });
      if (variables.renterId) {
        void queryClient.invalidateQueries({
          queryKey: [...rentalInvoicesQueryKey, "renter-invoices", variables.renterId],
          refetchType: "active",
        });
      }
    },
  });
}

export function fiscalInputToRpcPayload(fiscal?: RentalFiscalInput) {
  if (!fiscal) return {};
  return {
    p_fiscal_status: fiscal.fiscalStatus ?? null,
    p_fiscal_receipt_number: fiscal.fiscalReceiptNumber?.trim() || null,
    p_fiscal_cash_register_id: fiscal.fiscalCashRegisterId?.trim() || null,
    p_fiscal_terminal_id: fiscal.fiscalTerminalId?.trim() || null,
    p_fiscal_acquiring_id: fiscal.fiscalAcquiringId?.trim() || null,
  };
}
