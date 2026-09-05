import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import type {
  RenterCommunicationType,
  RenterContact,
  RenterContract,
  RenterContractStatus,
  RenterCounterpartyType,
  RenterDebtFilter,
  RenterDetail,
  RenterDocument,
  RenterDuplicateMatch,
  RenterFinanceSummary,
  RenterListItem,
  RenterRentalCounts,
  RenterRentalRow,
  RenterStatus,
  RenterUpsertInput,
} from "../types";
import { reportClientError } from "../lib/reportClientError";
import {
  bindUploadedRenterDocument,
  removeRenterStorageObject,
} from "../lib/renterDocumentUpload";
import { useOrgQueryScope } from "./useOrgQueryScope";
import { rentalsQueryKey } from "./useRentals";
import { rentersQueryKey } from "./useRenters";

export interface RentersListFilters {
  search?: string;
  type?: RenterCounterpartyType | null;
  status?: RenterStatus | null;
  debtFilter?: RenterDebtFilter | null;
  upcoming?: boolean | null;
}

export function rentersListQueryKey(filters: RentersListFilters = {}) {
  return [...rentersQueryKey, "list", filters] as const;
}

export function renterDetailQueryKey(renterId: string) {
  return [...rentersQueryKey, "detail", renterId] as const;
}

export function renterRentalsQueryKey(renterId: string) {
  return [...rentersQueryKey, "rentals", renterId] as const;
}

function mapListItem(row: Record<string, unknown>): RenterListItem {
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? ""),
    counterpartyType: (row.counterparty_type as RenterCounterpartyType) ?? "individual",
    status: (row.status as RenterStatus) ?? "active",
    contactPhone: row.contact_phone != null ? String(row.contact_phone) : null,
    contactEmail: row.contact_email != null ? String(row.contact_email) : null,
    primaryContactName: row.primary_contact_name != null ? String(row.primary_contact_name) : null,
    nextRentalDate: row.next_rental_date != null ? String(row.next_rental_date).slice(0, 10) : null,
    cashierDebt: row.cashier_debt != null ? Number(row.cashier_debt) : null,
    miniappDebt: row.miniapp_debt != null ? Number(row.miniapp_debt) : null,
    hasExpiringDocument: Boolean(row.has_expiring_document),
    hasOverdueDebt: Boolean(row.has_overdue_debt),
    hasNextActionDue: Boolean(row.has_next_action_due),
    telegramId: row.telegram_id != null ? String(row.telegram_id) : null,
  };
}

function mapContact(row: Record<string, unknown>): RenterContact {
  return {
    id: String(row.id),
    fullName: String(row.full_name ?? ""),
    roleTitle: row.role_title != null ? String(row.role_title) : null,
    phone: row.phone != null ? String(row.phone) : null,
    email: row.email != null ? String(row.email) : null,
    telegram: row.telegram != null ? String(row.telegram) : null,
    isPrimary: Boolean(row.is_primary),
    notes: row.notes != null ? String(row.notes) : null,
  };
}

function mapContract(row: Record<string, unknown>): RenterContract {
  return {
    id: String(row.id),
    contractNumber: row.contract_number != null ? String(row.contract_number) : null,
    title: String(row.title ?? ""),
    contractType: row.contract_type != null ? String(row.contract_type) : null,
    signedAt: row.signed_at != null ? String(row.signed_at).slice(0, 10) : null,
    validFrom: row.valid_from != null ? String(row.valid_from).slice(0, 10) : null,
    validTo: row.valid_to != null ? String(row.valid_to).slice(0, 10) : null,
    status: (row.status as RenterContractStatus) ?? "draft",
    signatoryName: row.signatory_name != null ? String(row.signatory_name) : null,
    locationIds: Array.isArray(row.location_ids)
      ? row.location_ids.map((id) => String(id))
      : [],
    depositInfo: row.deposit_info != null ? String(row.deposit_info) : null,
  };
}

function mapDocument(row: Record<string, unknown>): RenterDocument {
  return {
    id: String(row.id),
    contractId: row.contract_id != null ? String(row.contract_id) : null,
    category: row.category != null ? String(row.category) : null,
    displayName: String(row.display_name ?? ""),
    documentDate: row.document_date != null ? String(row.document_date).slice(0, 10) : null,
    validUntil: row.valid_until != null ? String(row.valid_until).slice(0, 10) : null,
    mimeType: String(row.mime_type ?? ""),
    fileSize: Number(row.file_size ?? 0),
    createdAt: String(row.created_at ?? ""),
  };
}

function mapCommunication(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    commType: row.comm_type as RenterCommunicationType,
    occurredAt: String(row.occurred_at ?? ""),
    subject: row.subject != null ? String(row.subject) : null,
    body: row.body != null ? String(row.body) : null,
    contactId: row.contact_id != null ? String(row.contact_id) : null,
    nextActionAt: row.next_action_at != null ? String(row.next_action_at) : null,
    authorMemberId: String(row.author_member_id ?? ""),
    createdAt: String(row.created_at ?? ""),
  };
}

function mapFinance(row: Record<string, unknown> | null): RenterFinanceSummary | null {
  if (!row) return null;
  return {
    fixedTotal: Number(row.fixed_total ?? 0),
    paidTotal: Number(row.paid_total ?? 0),
    debtTotal: Number(row.debt_total ?? 0),
    overpaidTotal: Number(row.overpaid_total ?? 0),
    walletBalance: Number(row.wallet_balance ?? 0),
    spendable: Number(row.spendable ?? 0),
    reservedPrepay: Number(row.reserved_prepay ?? 0),
    miniappDebtTotal: Number(row.miniapp_debt_total ?? 0),
    walletEntries: Array.isArray(row.wallet_entries)
      ? (row.wallet_entries as Record<string, unknown>[]).map((entry) => ({
          id: String(entry.id),
          entryType: String(entry.entry_type ?? entry.entryType ?? ""),
          amount: Number(entry.amount) || 0,
          createdAt: String(entry.created_at ?? ""),
          externalReference:
            entry.external_reference != null ? String(entry.external_reference) : null,
          correctionReason:
            entry.correction_reason != null ? String(entry.correction_reason) : null,
          correctsLedgerId:
            entry.corrects_ledger_id != null ? String(entry.corrects_ledger_id) : null,
          payoutMethod: entry.payout_method != null ? String(entry.payout_method) : null,
          canReverse: Boolean(entry.can_reverse),
        }))
      : [],
    miniappDebts: Array.isArray(row.miniapp_debts)
      ? (row.miniapp_debts as Record<string, unknown>[]).map((debt) => ({
          rentalId: String(debt.rental_id),
          rentalDate: String(debt.rental_date ?? "").slice(0, 10),
          timeStart: String(debt.time_start ?? ""),
          timeEnd: String(debt.time_end ?? ""),
          debtAmount: Number(debt.debt_amount) || 0,
          locationId: debt.location_id != null ? String(debt.location_id) : null,
        }))
      : [],
  };
}

function mapRentalCounts(row: Record<string, unknown> | null): RenterRentalCounts {
  return {
    completed: Number(row?.completed ?? 0),
    upcoming: Number(row?.upcoming ?? 0),
    cancelled: Number(row?.cancelled ?? 0),
  };
}

function mapRentalRow(row: Record<string, unknown>): RenterRentalRow {
  return {
    id: String(row.id),
    rentalDate: String(row.rental_date).slice(0, 10),
    timeStart: String(row.time_start ?? ""),
    timeEnd: String(row.time_end ?? ""),
    locationId: String(row.location_id),
    purpose: row.purpose != null ? String(row.purpose) : null,
    bookingStatus: (row.booking_status as "confirmed" | "cancelled") ?? "confirmed",
    channel: row.channel === "miniapp" ? "miniapp" : "cashier",
    lifecycle: row.lifecycle != null ? String(row.lifecycle) : null,
    fixedAmount: row.fixed_amount != null ? Number(row.fixed_amount) : null,
    currency: row.currency != null ? String(row.currency) : null,
    paidAmount: row.paid_amount != null ? Number(row.paid_amount) : null,
    paymentStatus: row.payment_status != null ? String(row.payment_status) : null,
    cancelledAt: row.cancelled_at != null ? String(row.cancelled_at) : null,
    debtAmount: row.debt_amount != null ? Number(row.debt_amount) : null,
  };
}

function mapDuplicate(row: Record<string, unknown>): RenterDuplicateMatch {
  return {
    id: String(row.id),
    displayName: String(row.display_name ?? ""),
    counterpartyType: (row.counterparty_type as RenterCounterpartyType) ?? "individual",
    status: (row.status as RenterStatus) ?? "active",
    contactPhone: row.contact_phone != null ? String(row.contact_phone) : null,
    contactEmail: row.contact_email != null ? String(row.contact_email) : null,
    taxId: row.tax_id != null ? String(row.tax_id) : null,
    matchFields: Array.isArray(row.match_fields) ? row.match_fields.map(String) : [],
  };
}

function upsertPayload(input: RenterUpsertInput) {
  const payload: Record<string, unknown> = {
    display_name: input.displayName,
  };
  if (input.renterId) payload.renter_id = input.renterId;
  if (input.counterpartyType) payload.counterparty_type = input.counterpartyType;
  if (input.status) payload.status = input.status;
  if (input.legalName !== undefined) payload.legal_name = input.legalName;
  if (input.taxId !== undefined) payload.tax_id = input.taxId;
  if (input.registrationNumber !== undefined) payload.registration_number = input.registrationNumber;
  if (input.legalAddress !== undefined) payload.legal_address = input.legalAddress;
  if (input.actualAddress !== undefined) payload.actual_address = input.actualAddress;
  if (input.contactPhone !== undefined) payload.contact_phone = input.contactPhone;
  if (input.contactEmail !== undefined) payload.contact_email = input.contactEmail;
  if (input.notes !== undefined) payload.notes = input.notes;
  if (input.blockedReason !== undefined) payload.blocked_reason = input.blockedReason;
  if (input.internalNotes !== undefined) payload.internal_notes = input.internalNotes;
  if (input.preferredLocationIds !== undefined) {
    payload.preferred_location_ids = input.preferredLocationIds;
  }
  if (input.paymentDueDays !== undefined) {
    payload.payment_due_days = input.paymentDueDays;
  }
  if (input.duplicateCreateReason) {
    payload.duplicate_create_reason = input.duplicateCreateReason;
  }
  if (input.telegramId !== undefined) {
    payload.telegram_id = input.telegramId ?? "";
  }
  return asJson(payload);
}

function invalidateRenterCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  renterId?: string
) {
  void queryClient.invalidateQueries({ queryKey: rentersQueryKey, refetchType: "active" });
  void queryClient.invalidateQueries({ queryKey: rentalsQueryKey, refetchType: "active" });
  if (renterId) {
    void queryClient.invalidateQueries({
      queryKey: renterDetailQueryKey(renterId),
      refetchType: "active",
    });
    void queryClient.invalidateQueries({
      queryKey: renterRentalsQueryKey(renterId),
      refetchType: "active",
    });
  }
}

export function useRentersList(filters: RentersListFilters = {}, options?: { enabled?: boolean }) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const queryEnabled = orgEnabled && (options?.enabled ?? true);

  return useQuery({
    queryKey: withOrgId(rentersListQueryKey(filters)),
    enabled: queryEnabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renters", {
        p_search: filters.search ?? null,
        p_type: filters.type ?? null,
        p_status: filters.status ?? null,
        p_debt_filter: filters.debtFilter ?? null,
        p_upcoming: filters.upcoming ?? null,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string; renters?: unknown[] } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "renters.error.loadFailed");
      }

      return (result.renters ?? []).map((row) => mapListItem(row as Record<string, unknown>));
    },
    staleTime: 60 * 1000,
  });
}

export function useRenterDetail(renterId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(renterDetailQueryKey(renterId ?? "")),
    enabled: orgEnabled && enabled && !!renterId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_renter_detail", {
        p_renter_id: renterId,
      });

      if (error) throw error;

      const result = data as Record<string, unknown> | null;
      if (!result?.success) {
        throw new Error(String(result?.error ?? "renters.error.loadFailed"));
      }

      const renter = result.renter as Record<string, unknown>;
      const detail: RenterDetail = {
        renter: {
          id: String(renter.id),
          displayName: String(renter.display_name ?? ""),
          counterpartyType: renter.counterparty_type as RenterCounterpartyType | null,
          status: (renter.status as RenterStatus) ?? "active",
          contactPhone: renter.contact_phone != null ? String(renter.contact_phone) : null,
          contactEmail: renter.contact_email != null ? String(renter.contact_email) : null,
          legalName: renter.legal_name != null ? String(renter.legal_name) : null,
          taxId: renter.tax_id != null ? String(renter.tax_id) : null,
          registrationNumber:
            renter.registration_number != null ? String(renter.registration_number) : null,
          legalAddress: renter.legal_address != null ? String(renter.legal_address) : null,
          actualAddress: renter.actual_address != null ? String(renter.actual_address) : null,
          blockedReason: renter.blocked_reason != null ? String(renter.blocked_reason) : null,
          internalNotes: renter.internal_notes != null ? String(renter.internal_notes) : null,
          preferredLocationIds: Array.isArray(renter.preferred_location_ids)
            ? renter.preferred_location_ids.map((id) => String(id))
            : null,
          paymentDueDays:
            renter.payment_due_days != null ? Number(renter.payment_due_days) : null,
          notes: renter.notes != null ? String(renter.notes) : null,
          archivedAt: renter.archived_at != null ? String(renter.archived_at) : null,
          nextRentalDate:
            renter.next_rental_date != null ? String(renter.next_rental_date).slice(0, 10) : null,
          telegramId: renter.telegram_id != null ? String(renter.telegram_id) : null,
          onTimeCount: renter.on_time_count != null ? Number(renter.on_time_count) : null,
          untimelyCount: renter.untimely_count != null ? Number(renter.untimely_count) : null,
          bookingBannedAt:
            renter.booking_banned_at != null ? String(renter.booking_banned_at) : null,
          penaltyTariffAppliedAt:
            renter.penalty_tariff_applied_at != null
              ? String(renter.penalty_tariff_applied_at)
              : null,
        },
        contacts: ((result.contacts as unknown[]) ?? []).map((row) =>
          mapContact(row as Record<string, unknown>)
        ),
        contracts: ((result.contracts as unknown[]) ?? []).map((row) =>
          mapContract(row as Record<string, unknown>)
        ),
        documents: ((result.documents as unknown[]) ?? []).map((row) =>
          mapDocument(row as Record<string, unknown>)
        ),
        communications: ((result.communications as unknown[]) ?? []).map((row) =>
          mapCommunication(row as Record<string, unknown>)
        ),
        finance: mapFinance((result.finance as Record<string, unknown> | null) ?? null),
        rentalCounts: mapRentalCounts(
          (result.rental_counts as Record<string, unknown> | null) ?? null
        ),
      };

      return detail;
    },
    staleTime: 30 * 1000,
  });
}

export function useRenterRentals(renterId: string | null, enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(renterRentalsQueryKey(renterId ?? "")),
    enabled: orgEnabled && enabled && !!renterId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_renter_rentals", {
        p_renter_id: renterId,
      });

      if (error) throw error;

      const result = data as { success?: boolean; error?: string; rentals?: unknown[] } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "renters.error.loadFailed");
      }

      return (result.rentals ?? []).map((row) => mapRentalRow(row as Record<string, unknown>));
    },
    staleTime: 30 * 1000,
  });
}

export function useCheckRenterDuplicates() {
  return useMutation({
    mutationFn: async (input: {
      renterId?: string;
      contactPhone?: string;
      contactEmail?: string;
      taxId?: string;
    }) => {
      const payload: Record<string, unknown> = {};
      if (input.renterId) payload.renter_id = input.renterId;
      if (input.contactPhone !== undefined) payload.contact_phone = input.contactPhone;
      if (input.contactEmail !== undefined) payload.contact_email = input.contactEmail;
      if (input.taxId !== undefined) payload.tax_id = input.taxId;

      const { data, error } = await supabase.rpc("check_renter_duplicates", {
        p_payload: asJson(payload),
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; duplicates?: unknown[] } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renters.error.duplicateCheckFailed" };
      }

      return {
        success: true as const,
        duplicates: (result.duplicates ?? []).map((row) =>
          mapDuplicate(row as Record<string, unknown>)
        ),
      };
    },
  });
}

export function useUpsertRenter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: RenterUpsertInput) => {
      const { data, error } = await supabase.rpc("upsert_renter", {
        p_payload: upsertPayload(input),
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; renter_id?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renters.error.saveFailed" };
      }

      return { success: true as const, renterId: result.renter_id ?? input.renterId ?? "" };
    },
    onSuccess: (result) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, result.renterId || undefined);
      }
    },
  });
}

export function useArchiveRenter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { renterId: string; force?: boolean; reason?: string }) => {
      const { data, error } = await supabase.rpc("archive_renter", {
        p_renter_id: input.renterId,
        p_force: input.force ?? false,
        p_reason: input.reason ?? null,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        renter_id?: string;
        already_applied?: boolean;
      } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renters.error.archiveFailed" };
      }

      return {
        success: true as const,
        renterId: result.renter_id ?? input.renterId,
        alreadyApplied: Boolean(result.already_applied),
      };
    },
    onSuccess: (result) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, result.renterId);
      }
    },
  });
}

export function useUpsertRenterContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      contactId?: string;
      fullName: string;
      roleTitle?: string;
      phone?: string;
      email?: string;
      telegram?: string;
      isPrimary?: boolean;
      notes?: string;
    }) => {
      const payload: Record<string, unknown> = {
        renter_id: input.renterId,
        full_name: input.fullName,
        is_primary: input.isPrimary ?? false,
      };
      if (input.contactId) payload.contact_id = input.contactId;
      if (input.roleTitle !== undefined) payload.role_title = input.roleTitle;
      if (input.phone !== undefined) payload.phone = input.phone;
      if (input.email !== undefined) payload.email = input.email;
      if (input.telegram !== undefined) payload.telegram = input.telegram;
      if (input.notes !== undefined) payload.notes = input.notes;

      const { data, error } = await supabase.rpc("upsert_renter_contact", { p_payload: asJson(payload) });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; contact_id?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renters.error.contactSaveFailed" };
      }

      return { success: true as const, contactId: result.contact_id ?? "" };
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, variables.renterId);
      }
    },
  });
}

export function useDeleteRenterContact() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { contactId: string; renterId: string }) => {
      const { data, error } = await supabase.rpc("delete_renter_contact", {
        p_contact_id: input.contactId,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renters.error.contactDeleteFailed" };
      }

      return { success: true as const };
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, variables.renterId);
      }
    },
  });
}

export function useUpsertRenterContract() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      contractId?: string;
      contractNumber?: string;
      title: string;
      contractType?: string;
      signedAt?: string;
      validFrom?: string;
      validTo?: string;
      status?: RenterContractStatus;
      signatoryName?: string;
      locationIds?: string[];
      accessTerms?: string;
      cancellationTerms?: string;
      depositInfo?: string;
      notes?: string;
      rentalIds?: string[];
    }) => {
      const payload: Record<string, unknown> = {
        renter_id: input.renterId,
        title: input.title,
      };
      if (input.contractId) payload.contract_id = input.contractId;
      if (input.contractNumber !== undefined) payload.contract_number = input.contractNumber;
      if (input.contractType !== undefined) payload.contract_type = input.contractType;
      if (input.signedAt !== undefined) payload.signed_at = input.signedAt;
      if (input.validFrom !== undefined) payload.valid_from = input.validFrom;
      if (input.validTo !== undefined) payload.valid_to = input.validTo;
      if (input.status) payload.status = input.status;
      if (input.signatoryName !== undefined) payload.signatory_name = input.signatoryName;
      if (input.locationIds !== undefined) payload.location_ids = input.locationIds;
      if (input.accessTerms !== undefined) payload.access_terms = input.accessTerms;
      if (input.cancellationTerms !== undefined) payload.cancellation_terms = input.cancellationTerms;
      if (input.depositInfo !== undefined) payload.deposit_info = input.depositInfo;
      if (input.notes !== undefined) payload.notes = input.notes;
      if (input.rentalIds !== undefined) payload.rental_ids = input.rentalIds;

      const { data, error } = await supabase.rpc("upsert_renter_contract", { p_payload: asJson(payload) });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; contract_id?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renters.error.contractSaveFailed" };
      }

      return { success: true as const, contractId: result.contract_id ?? "" };
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, variables.renterId);
      }
    },
  });
}

export function useUploadRenterDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      file: File;
      displayName: string;
      contractId?: string;
      category?: string;
      documentDate?: string;
      validUntil?: string;
      notes?: string;
    }) => {
      const { data: prepData, error: prepError } = await supabase.rpc(
        "prepare_renter_document_upload",
        {
          p_renter_id: input.renterId,
          p_filename: input.file.name,
          p_mime: input.file.type,
          p_size: input.file.size,
        }
      );

      if (prepError) return { success: false as const, error: prepError.message };

      const prep = prepData as {
        success?: boolean;
        error?: string;
        storage_path?: string;
        bucket?: string;
      } | null;
      if (!prep?.success || !prep.storage_path || !prep.bucket) {
        return { success: false as const, error: prep?.error ?? "renters.error.documentPrepareFailed" };
      }

      try {
        const { error: uploadError } = await supabase.storage
          .from(prep.bucket)
          .upload(prep.storage_path, input.file, { contentType: input.file.type, upsert: false });

        if (uploadError) {
          await removeRenterStorageObject(prep.bucket, prep.storage_path);
          return { success: false as const, error: uploadError.message };
        }

        const finalizePayload: Record<string, unknown> = {
          renter_id: input.renterId,
          storage_path: prep.storage_path,
          mime_type: input.file.type,
          file_size: input.file.size,
          display_name: input.displayName,
        };
        if (input.contractId) finalizePayload.contract_id = input.contractId;
        if (input.category) finalizePayload.category = input.category;
        if (input.documentDate) finalizePayload.document_date = input.documentDate;
        if (input.validUntil) finalizePayload.valid_until = input.validUntil;
        if (input.notes) finalizePayload.notes = input.notes;

        const fin = await bindUploadedRenterDocument({
          bucket: prep.bucket,
          storagePath: prep.storage_path,
          finalizePayload,
        });
        if (fin.success === false) {
          return { success: false as const, error: fin.error };
        }
        return { success: true as const, documentId: fin.documentId };
      } catch (err) {
        await removeRenterStorageObject(prep.bucket, prep.storage_path);
        reportClientError(err, {
          area: "mutation",
          action: "useUploadRenterDocument",
          meta: { renterId: input.renterId, storagePath: prep.storage_path },
        });
        return {
          success: false as const,
          error: err instanceof Error ? err.message : "renters.error.documentUploadFailed",
        };
      }
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, variables.renterId);
      }
    },
  });
}

export function useDownloadRenterDocument() {
  return useMutation({
    mutationFn: async (documentId: string) => {
      const { data, error } = await supabase.rpc("get_renter_document_download_url", {
        p_document_id: documentId,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as {
        success?: boolean;
        error?: string;
        bucket?: string;
        storage_path?: string;
        expires_in?: number;
      } | null;
      if (!result?.success || !result.bucket || !result.storage_path) {
        return { success: false as const, error: result?.error ?? "renters.error.documentDownloadFailed" };
      }

      const { data: signed, error: signError } = await supabase.storage
        .from(result.bucket)
        .createSignedUrl(result.storage_path, result.expires_in ?? 300);

      if (signError || !signed?.signedUrl) {
        return { success: false as const, error: signError?.message ?? "renters.error.documentDownloadFailed" };
      }

      return { success: true as const, url: signed.signedUrl };
    },
  });
}

export function useDeleteRenterDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { documentId: string; renterId: string }) => {
      const { data, error } = await supabase.rpc("delete_renter_document", {
        p_document_id: input.documentId,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renters.error.documentDeleteFailed" };
      }

      return { success: true as const };
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, variables.renterId);
      }
    },
  });
}

export function useCreateRenterCommunication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      renterId: string;
      commType: RenterCommunicationType;
      occurredAt?: string;
      subject?: string;
      body?: string;
      contactId?: string;
      nextActionAt?: string;
    }) => {
      const payload: Record<string, unknown> = {
        renter_id: input.renterId,
        comm_type: input.commType,
      };
      if (input.occurredAt) payload.occurred_at = input.occurredAt;
      if (input.subject !== undefined) payload.subject = input.subject;
      if (input.body !== undefined) payload.body = input.body;
      if (input.contactId) payload.contact_id = input.contactId;
      if (input.nextActionAt) payload.next_action_at = input.nextActionAt;

      const { data, error } = await supabase.rpc("create_renter_communication", {
        p_payload: asJson(payload),
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string; communication_id?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "renters.error.communicationSaveFailed" };
      }

      return { success: true as const, communicationId: result.communication_id ?? "" };
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, variables.renterId);
      }
    },
  });
}

export function useUpdateRenterCommunication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      communicationId: string;
      renterId: string;
      reason: string;
      commType?: RenterCommunicationType;
      occurredAt?: string;
      subject?: string;
      body?: string;
      contactId?: string | null;
      nextActionAt?: string | null;
    }) => {
      const payload: Record<string, unknown> = {};
      if (input.commType) payload.comm_type = input.commType;
      if (input.occurredAt) payload.occurred_at = input.occurredAt;
      if (input.subject !== undefined) payload.subject = input.subject;
      if (input.body !== undefined) payload.body = input.body;
      if (input.contactId !== undefined) payload.contact_id = input.contactId;
      if (input.nextActionAt !== undefined) payload.next_action_at = input.nextActionAt;

      const { data, error } = await supabase.rpc("update_renter_communication", {
        p_comm_id: input.communicationId,
        p_payload: asJson(payload),
        p_reason: input.reason,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "renters.error.communicationUpdateFailed",
        };
      }

      return { success: true as const };
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, variables.renterId);
      }
    },
  });
}

export function useDeleteRenterCommunication() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { communicationId: string; renterId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("delete_renter_communication", {
        p_comm_id: input.communicationId,
        p_reason: input.reason,
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "renters.error.communicationDeleteFailed",
        };
      }

      return { success: true as const };
    },
    onSuccess: (result, variables) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, variables.renterId);
      }
    },
  });
}

export function useResetRenterReliability() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { renterId: string; reason: string }) => {
      const { data, error } = await supabase.rpc("reset_renter_reliability", {
        p_renter_id: input.renterId,
        p_reason: input.reason.trim(),
      });

      if (error) return { success: false as const, error: error.message };

      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: result?.error ?? "renters.error.reliabilityResetFailed",
        };
      }

      return { success: true as const };
    },
    onSuccess: (result, input) => {
      if (result.success) {
        invalidateRenterCaches(queryClient, input.renterId);
      }
    },
  });
}
